"""Saomi site server.

Serves the static site and a small JSON API for accounts, orders, contact
messages and newsletter sign-ups. Standard library only.

    python server.py            -> http://127.0.0.1:5500

Accounts use email verification: a 6-digit code is emailed to confirm a new
account, on every sign-in, and to reset a forgotten password.

Settings come from environment variables or a `.env` file next to this script
(see `.env.example`): SAOMI_HOST, SAOMI_PORT, SAOMI_DB, SAOMI_SITE_URL and the
SAOMI_SMTP_* / SAOMI_MAIL_FROM mail settings. Without mail settings, emails are
saved to data/outbox/ and printed in this console instead of being sent.
"""

import hashlib
import hmac
import html
import http.server
import json
import os
import re
import secrets
import smtplib
import sqlite3
import ssl
import threading
import time
from contextlib import contextmanager
from email.message import EmailMessage
from email.utils import formataddr, parseaddr
from http.cookies import SimpleCookie
from urllib.parse import urlsplit

ROOT = os.path.dirname(os.path.abspath(__file__))


def load_env(path):
    """Reads KEY=VALUE lines from .env without overriding real environment variables."""
    if not os.path.exists(path):
        return
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


load_env(os.path.join(ROOT, ".env"))

DB_PATH = os.environ.get("SAOMI_DB", os.path.join(ROOT, "data", "saomi.db"))
OUTBOX = os.path.join(os.path.dirname(DB_PATH), "outbox")
HOST = os.environ.get("SAOMI_HOST", "127.0.0.1")
PORT = int(os.environ.get("SAOMI_PORT", "5500"))
SITE_URL = os.environ.get("SAOMI_SITE_URL", f"http://{HOST}:{PORT}").rstrip("/")

SMTP_HOST = os.environ.get("SAOMI_SMTP_HOST", "")
SMTP_PORT = int(os.environ.get("SAOMI_SMTP_PORT", "587"))
SMTP_USER = os.environ.get("SAOMI_SMTP_USER", "")
SMTP_PASSWORD = os.environ.get("SAOMI_SMTP_PASSWORD", "").replace(" ", "")  # Gmail shows app passwords in groups
MAIL_FROM = os.environ.get("SAOMI_MAIL_FROM") or (formataddr(("Saomi", SMTP_USER)) if SMTP_USER else "Saomi <no-reply@localhost>")
MAIL_READY = bool(SMTP_HOST and SMTP_USER and SMTP_PASSWORD)

SESSION_COOKIE = "saomi_session"
CHALLENGE_COOKIE = "saomi_challenge"
REMEMBER_SECONDS = 30 * 24 * 3600   # "Keep me signed in"
BROWSER_SECONDS = 12 * 3600          # otherwise: until the browser closes, at most 12 hours
PBKDF2_ITERATIONS = 600_000
MAX_BODY = 64 * 1024

CODE_SECONDS = 10 * 60      # a code is valid for 10 minutes
PASSWORD_STEP_SECONDS = 15 * 60  # time to choose a password after a sign-up or reset code is accepted
CHALLENGE_SECONDS = 30 * 60
MAX_CODE_ATTEMPTS = 5
RESEND_AFTER = 60
MAX_SENDS = 5               # per challenge
MAIL_PER_HOUR = 8           # per email address

LOGIN_WINDOW = 10 * 60
LOGIN_MAX_FAILURES = 8
EMAIL_RE = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]{2,}$")
CODE_RE = re.compile(r"^\d{6}$")

COMMON_PASSWORDS = {
    "password", "password1", "password12", "password123", "passw0rd", "12345678", "123456789",
    "1234567890", "qwerty123", "qwertyuiop", "iloveyou1", "11111111", "abc12345", "abcd1234",
    "letmein1", "welcome1", "welcome123", "admin123", "1q2w3e4r", "sunshine1", "football1",
    "princess1", "monkey123", "dragon123", "saomi123", "perfume1", "perfume123",
}

# Never served as static files (dotfiles such as .env are blocked as well).
PRIVATE = ("data", "server.py", "_ref")

# Prices are checked here so an order total never comes from the browser.
CATALOG = {
    "soleil-dor": ("Soleil d’Or", {"30 ml": 125, "50 ml": 185, "100 ml": 265}),
    "velours-noir": ("Velours Noir", {"30 ml": 140, "50 ml": 205, "100 ml": 290}),
    "rose-imperiale": ("Rose Impériale", {"30 ml": 120, "50 ml": 170, "100 ml": 245}),
    "verdant-obsession": ("Verdant Obsession", {"30 ml": 115, "50 ml": 165, "100 ml": 240}),
    "lumiere-dopal": ("Lumière d’Opal", {"30 ml": 110, "50 ml": 160, "100 ml": 230}),
    "santal-majeste": ("Santal Majesté", {"30 ml": 135, "50 ml": 195, "100 ml": 280}),
    "aura-celeste": ("Aura Céleste", {"30 ml": 105, "50 ml": 150, "100 ml": 215}),
    "elixir-de-nuit": ("Élixir de Nuit", {"30 ml": 150, "50 ml": 215, "100 ml": 305}),
    "jasmin-eternel": ("Jasmin Éternel", {"30 ml": 130, "50 ml": 190, "100 ml": 270}),
    "cuir-imperial": ("Cuir Impérial", {"30 ml": 155, "50 ml": 225, "100 ml": 320}),
    "nectar-dor": ("Nectar d’Or", {"30 ml": 135, "50 ml": 195, "100 ml": 280}),
    "ombre-rose": ("Ombre Rose", {"30 ml": 145, "50 ml": 210, "100 ml": 300}),
    "fleur-sauvage": ("Fleur Sauvage", {"30 ml": 115, "50 ml": 165, "100 ml": 240}),
    "ocean-infini": ("Océan Infini", {"30 ml": 110, "50 ml": 160, "100 ml": 230}),
    "bois-de-cashmere": ("Bois de Cashmere", {"30 ml": 125, "50 ml": 180, "100 ml": 260}),
}
CONTACT_TOPICS = {"Order", "Product advice", "Gifting", "Other"}

_limits = {}
_limits_lock = threading.Lock()


# ---------- Storage ----------

@contextmanager
def db():
    """One connection per request: commits on success, rolls back on error, always closes."""
    conn = sqlite3.connect(DB_PATH, timeout=10)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    try:
        with conn:
            yield conn
    finally:
        conn.close()


def init_db():
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    with db() as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY,
                name TEXT NOT NULL,
                email TEXT NOT NULL UNIQUE,
                password TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                verified INTEGER NOT NULL DEFAULT 0
            );
            CREATE TABLE IF NOT EXISTS sessions (
                token_hash TEXT PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                expires_at INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS challenges (
                token_hash TEXT PRIMARY KEY,
                purpose TEXT NOT NULL,
                user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                email TEXT NOT NULL,
                code_hash TEXT NOT NULL,
                data TEXT NOT NULL DEFAULT '{}',
                attempts INTEGER NOT NULL DEFAULT 0,
                sends INTEGER NOT NULL DEFAULT 1,
                verified INTEGER NOT NULL DEFAULT 0,
                sent_at INTEGER NOT NULL,
                expires_at INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS orders (
                id INTEGER PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                items TEXT NOT NULL,
                subtotal INTEGER NOT NULL,
                created_at INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS messages (
                id INTEGER PRIMARY KEY,
                name TEXT NOT NULL,
                email TEXT NOT NULL,
                topic TEXT NOT NULL,
                message TEXT NOT NULL,
                created_at INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS subscribers (
                email TEXT PRIMARY KEY,
                created_at INTEGER NOT NULL
            );
            """
        )
        columns = {row["name"] for row in conn.execute("PRAGMA table_info(users)")}
        if "verified" not in columns:  # accounts made before verification existed count as verified
            conn.execute("ALTER TABLE users ADD COLUMN verified INTEGER NOT NULL DEFAULT 1")


# ---------- Passwords, codes and limits ----------

def hash_password(password, salt=None, iterations=PBKDF2_ITERATIONS):
    salt = salt or secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, iterations)
    return f"pbkdf2_sha256${iterations}${salt.hex()}${digest.hex()}"


def check_password(password, stored):
    try:
        _, iterations, salt, digest = stored.split("$")
        expected = hash_password(password, bytes.fromhex(salt), int(iterations)).split("$")[3]
    except ValueError:
        return False
    return hmac.compare_digest(expected, digest)


# Burns the same time as a real check when the email is unknown, so timing doesn't reveal accounts.
_DUMMY_HASH = hash_password(secrets.token_hex(8))


def password_problem(password, email="", name=""):
    if not isinstance(password, str) or len(password) < 8:
        return "Your password needs at least 8 characters."
    if len(password) > 128:
        return "Your password can be at most 128 characters."
    if not re.search(r"[A-Za-z]", password) or not re.search(r"\d", password):
        return "Use at least one letter and one number."
    lowered = password.lower()
    local = email.split("@")[0].lower()
    if lowered in COMMON_PASSWORDS or (len(local) >= 4 and local in lowered) or (name and name.lower().replace(" ", "") == lowered):
        return "That password is too easy to guess. Please choose another."
    return None


def token_hash(token):
    return hashlib.sha256(token.encode()).hexdigest()


def code_hash(challenge_hash, code):
    return hashlib.sha256(f"{challenge_hash}:{code}".encode()).hexdigest()


def new_code():
    return f"{secrets.randbelow(1_000_000):06d}"


def mask_email(email):
    local, _, domain = email.partition("@")
    return f"{local[:1]}{'•' * max(3, min(len(local) - 1, 6))}@{domain}"


def public_user(row):
    return {"name": row["name"], "email": row["email"], "createdAt": row["created_at"]}


def order_view(row):
    return {
        "number": f"SA-{row['id']:05d}",
        "items": json.loads(row["items"]),
        "subtotal": row["subtotal"],
        "createdAt": row["created_at"],
    }


def limited(key, window, limit):
    """True once `key` has been recorded `limit` times inside `window` seconds."""
    now = time.time()
    with _limits_lock:
        recent = [t for t in _limits.get(key, []) if now - t < window]
        _limits[key] = recent
        return len(recent) >= limit


def record(key):
    with _limits_lock:
        _limits.setdefault(key, []).append(time.time())


def forget(key):
    with _limits_lock:
        _limits.pop(key, None)


def clean_text(value, limit):
    return value.strip()[:limit] if isinstance(value, str) else ""


# ---------- Email ----------

PURPOSES = {
    "signup": ("Confirm your email", "Use this code to confirm your email and finish creating your Saomi account."),
    "login": ("Your sign-in code", "Use this code to finish signing in to Saomi."),
    "reset": ("Reset your password", "Use this code to reset the password for your Saomi account."),
}


def email_shell(kicker, body_html):
    return f"""<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="margin:0;background:#fbf7f0;font-family:Helvetica,Arial,sans-serif;color:#2b2118">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#fbf7f0;padding:40px 16px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border:1px solid #eadfcd">
<tr><td style="background:#231910;padding:26px;text-align:center;font-family:Georgia,serif;font-style:italic;font-size:30px;color:#e7cfa3">Saomi</td></tr>
<tr><td style="padding:34px 32px 10px">
<p style="margin:0 0 10px;font-size:11px;letter-spacing:3px;text-transform:uppercase;color:#8a6844">{html.escape(kicker)}</p>
{body_html}
</td></tr>
<tr><td style="padding:18px 32px;border-top:1px solid #eadfcd;font-size:10px;letter-spacing:2px;text-transform:uppercase;color:#a89a87">Saomi · Maison de Parfum</td></tr>
</table></td></tr></table></body></html>"""


def code_email(purpose, code, name):
    title, line = PURPOSES[purpose]
    hello = f"Hello {name}," if name else "Hello,"
    text = (f"{hello}\n\n{line}\n\n    {code}\n\nThe code expires in 10 minutes. If you didn't ask for it, "
            f"you can ignore this email and your account stays safe.\n\nSaomi · Maison de Parfum\n")
    body = (f'<p style="margin:0 0 22px;font-size:15px;line-height:1.6">{html.escape(hello)}<br>{html.escape(line)}</p>'
            f'<p style="margin:0 0 22px;padding:18px;text-align:center;background:#f4ecdf;font-size:34px;letter-spacing:10px;font-weight:bold;color:#17110b">{code}</p>'
            '<p style="margin:0 0 26px;font-size:13px;line-height:1.6;color:#7a6a58">The code expires in 10 minutes. '
            "If you didn't ask for it, you can ignore this email and your account stays safe.</p>")
    return f"{code} is your Saomi code", text, email_shell(title, body)


def password_changed_email(name):
    hello = f"Hello {name}," if name else "Hello,"
    reset = f"{SITE_URL}/forgot.html"
    text = (f"{hello}\n\nThe password for your Saomi account was just changed. If this was you, there's nothing else to do.\n\n"
            f"If it wasn't you, reset your password straight away: {reset}\n\nSaomi · Maison de Parfum\n")
    body = (f'<p style="margin:0 0 18px;font-size:15px;line-height:1.6">{html.escape(hello)}<br>The password for your Saomi account was just changed. '
            "If this was you, there's nothing else to do.</p>"
            f'<p style="margin:0 0 26px;font-size:14px;line-height:1.6">If it wasn\'t you, <a href="{html.escape(reset)}" style="color:#a8823f">reset your password</a> straight away.</p>')
    return "Your Saomi password was changed", text, email_shell("Account security", body)


def send_mail(to, subject, text, html_body):
    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = MAIL_FROM
    msg["To"] = to
    msg.set_content(text)
    msg.add_alternative(html_body, subtype="html")
    if not MAIL_READY:
        os.makedirs(OUTBOX, exist_ok=True)
        path = os.path.join(OUTBOX, f"{int(time.time() * 1000)}-{secrets.token_hex(3)}.eml")
        with open(path, "wb") as f:
            f.write(bytes(msg))
        print(f"[mail] Email isn't set up yet, so nothing was sent. To {to}: \"{subject}\" (saved to {path})", flush=True)
        return True
    try:
        context = ssl.create_default_context()
        if SMTP_PORT == 465:
            server = smtplib.SMTP_SSL(SMTP_HOST, SMTP_PORT, timeout=20, context=context)
        else:
            server = smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=20)
            server.starttls(context=context)
        with server:
            server.login(SMTP_USER, SMTP_PASSWORD)
            server.send_message(msg)
        print(f"[mail] Sent an email to {to}", flush=True)
        return True
    except (smtplib.SMTPException, OSError) as exc:
        print(f"[mail] Couldn't send to {to}: {exc}", flush=True)
        return False


# ---------- HTTP ----------

class Handler(http.server.SimpleHTTPRequestHandler):
    server_version = "Saomi"

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def end_headers(self):
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "same-origin")
        self.send_header("X-Frame-Options", "SAMEORIGIN")
        if not self.path.startswith("/api/"):
            self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    # Static files

    def blocked(self):
        root = os.path.normcase(os.path.realpath(ROOT))
        target = os.path.normcase(os.path.realpath(self.translate_path(self.path)))
        if target != root and not target.startswith(root + os.sep):
            return True
        rel = os.path.relpath(target, root)
        parts = [] if rel == "." else rel.split(os.sep)
        if any(part.startswith(".") for part in parts):
            return True
        return bool(parts) and parts[0] in {os.path.normcase(p) for p in PRIVATE}

    def do_GET(self):
        path = urlsplit(self.path).path
        if path.startswith("/api/"):
            return self.api("GET", path)
        if self.blocked():
            return self.send_error(404)
        return super().do_GET()

    def do_HEAD(self):
        if urlsplit(self.path).path.startswith("/api/") or self.blocked():
            return self.send_error(404)
        return super().do_HEAD()

    def do_POST(self):
        path = urlsplit(self.path).path
        if path.startswith("/api/"):
            return self.api("POST", path)
        return self.send_error(405)

    # API plumbing

    def api(self, method, path):
        routes = {
            ("GET", "/api/me"): self.api_me,
            ("GET", "/api/orders"): self.api_orders,
            ("GET", "/api/challenge"): self.api_challenge,
            ("POST", "/api/signup"): self.api_signup,
            ("POST", "/api/login"): self.api_login,
            ("POST", "/api/verify"): self.api_verify,
            ("POST", "/api/resend"): self.api_resend,
            ("POST", "/api/forgot"): self.api_forgot,
            ("POST", "/api/set-password"): self.api_set_password,
            ("POST", "/api/password"): self.api_change_password,
            ("POST", "/api/logout"): self.api_logout,
            ("POST", "/api/logout-all"): self.api_logout_all,
            ("POST", "/api/orders"): self.api_place_order,
            ("POST", "/api/contact"): self.api_contact,
            ("POST", "/api/subscribe"): self.api_subscribe,
        }
        handler = routes.get((method, path))
        if not handler:
            return self.send_json(404, {"error": "Not found."})
        if method == "GET":
            return handler()
        if not self.same_origin():
            return self.send_json(403, {"error": "This request was blocked."})
        if self.headers.get("Content-Type", "").split(";")[0].strip().lower() != "application/json":
            return self.send_json(415, {"error": "Please send JSON."})
        body = self.read_json()
        if not isinstance(body, dict):
            return self.send_json(400, {"error": "That request couldn't be read."})
        return handler(body)

    def same_origin(self):
        origin = self.headers.get("Origin")
        return origin is None or urlsplit(origin).netloc == self.headers.get("Host")

    def read_json(self):
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            return None
        if length <= 0 or length > MAX_BODY:
            return None
        try:
            return json.loads(self.rfile.read(length))
        except (ValueError, UnicodeDecodeError):
            return None

    def send_json(self, status, payload, cookies=()):
        data = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        for cookie in cookies:
            self.send_header("Set-Cookie", cookie)
        self.end_headers()
        self.wfile.write(data)

    # Cookies

    def make_cookie(self, name, value, max_age):
        secure = "; Secure" if self.headers.get("X-Forwarded-Proto") == "https" else ""
        age = "" if max_age is None else f"; Max-Age={max_age}"
        return f"{name}={value}{age}; Path=/; HttpOnly; SameSite=Lax{secure}"

    def read_cookie(self, name):
        jar = SimpleCookie()
        try:
            jar.load(self.headers.get("Cookie", ""))
        except Exception:
            return None
        morsel = jar.get(name)
        return morsel.value if morsel else None

    # Sessions

    def current_user(self, conn):
        token = self.read_cookie(SESSION_COOKIE)
        if not token:
            return None
        return conn.execute(
            "SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id "
            "WHERE s.token_hash = ? AND s.expires_at > ? AND u.verified = 1",
            (token_hash(token), int(time.time())),
        ).fetchone()

    def start_session(self, conn, user_id, remember):
        token = secrets.token_urlsafe(32)
        now = int(time.time())
        lifetime = REMEMBER_SECONDS if remember else BROWSER_SECONDS
        conn.execute("DELETE FROM sessions WHERE expires_at <= ?", (now,))
        conn.execute(
            "INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)",
            (token_hash(token), user_id, now + lifetime),
        )
        return self.make_cookie(SESSION_COOKIE, token, lifetime if remember else None)

    # Email-code challenges

    def current_challenge(self, conn):
        token = self.read_cookie(CHALLENGE_COOKIE)
        if not token:
            return None
        return conn.execute(
            "SELECT * FROM challenges WHERE token_hash = ? AND expires_at > ?",
            (token_hash(token), int(time.time())),
        ).fetchone()

    def create_challenge(self, conn, purpose, email, user_id, data=None):
        """Stores a new code for `email`; returns (cookie, code). Replaces this browser's previous challenge."""
        old = self.read_cookie(CHALLENGE_COOKIE)
        if old:
            conn.execute("DELETE FROM challenges WHERE token_hash = ?", (token_hash(old),))
        now = int(time.time())
        conn.execute("DELETE FROM challenges WHERE expires_at <= ?", (now,))
        token = secrets.token_urlsafe(32)
        hashed = token_hash(token)
        code = new_code()
        conn.execute(
            "INSERT INTO challenges (token_hash, purpose, user_id, email, code_hash, data, sent_at, expires_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (hashed, purpose, user_id, email, code_hash(hashed, code), json.dumps(data or {}), now, now + CODE_SECONDS),
        )
        return self.make_cookie(CHALLENGE_COOKIE, token, CHALLENGE_SECONDS), code

    def mail_code(self, purpose, email, name, code):
        record(("mail", email))
        return send_mail(email, *code_email(purpose, code, name))

    def mail_blocked(self, email):
        return limited(("mail", email), 3600, MAIL_PER_HOUR)

    def challenge_reply(self, purpose, email, cookie):
        return self.send_json(200, {"next": "verify", "purpose": purpose, "email": mask_email(email), "resendIn": RESEND_AFTER}, [cookie])

    NO_MAIL = {"error": "We couldn't send the email just now. Please try again in a few minutes."}
    TOO_MANY_MAILS = {"error": "We've sent several codes to this address. Please wait a while before asking for another."}

    # Endpoints: accounts

    def api_me(self):
        with db() as conn:
            user = self.current_user(conn)
        return self.send_json(200, {"user": public_user(user) if user else None})

    def api_signup(self, body):
        """Step 1 of registration: name and email only. The password is chosen after the email is confirmed."""
        name = clean_text(body.get("name"), 80)
        email = clean_text(body.get("email"), 254).lower()
        newsletter = body.get("newsletter") is True
        if not name:
            return self.send_json(400, {"error": "Please enter your full name.", "field": "name"})
        if not EMAIL_RE.match(email):
            return self.send_json(400, {"error": "Please enter a valid email address.", "field": "email"})
        if self.mail_blocked(email):
            return self.send_json(429, self.TOO_MANY_MAILS)
        taken = {"error": "An account with this email already exists. Please sign in instead.", "field": "email"}
        try:
            with db() as conn:
                existing = conn.execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()
                if existing and existing["verified"]:
                    return self.send_json(409, taken)
                if existing:  # started before but never finished: start over with the new details
                    conn.execute("UPDATE users SET name = ?, password = '' WHERE id = ?", (name, existing["id"]))
                    user_id = existing["id"]
                else:
                    user_id = conn.execute(
                        "INSERT INTO users (name, email, password, created_at, verified) VALUES (?, ?, '', ?, 0)",
                        (name, email, int(time.time())),
                    ).lastrowid
                cookie, code = self.create_challenge(conn, "signup", email, user_id, {"newsletter": newsletter, "remember": True})
        except sqlite3.IntegrityError:  # two sign-ups for the same email at once
            return self.send_json(409, taken)
        if not self.mail_code("signup", email, name, code):
            return self.send_json(502, self.NO_MAIL)
        return self.challenge_reply("signup", email, cookie)

    def api_login(self, body):
        email = clean_text(body.get("email"), 254).lower()
        password = body.get("password") if isinstance(body.get("password"), str) else ""
        remember = body.get("remember") is not False
        key = ("login", self.client_address[0], email)
        if limited(key, LOGIN_WINDOW, LOGIN_MAX_FAILURES):
            return self.send_json(429, {"error": "Too many attempts. Please wait a few minutes and try again."})
        with db() as conn:
            row = conn.execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()
            user = row if row and row["verified"] else None  # unfinished registrations can't sign in
            ok = check_password(password, user["password"] if user else _DUMMY_HASH) and user is not None
            if not ok:
                record(key)
                return self.send_json(401, {"error": "That email and password don't match. Please try again."})
            if self.mail_blocked(email):
                return self.send_json(429, self.TOO_MANY_MAILS)
            cookie, code = self.create_challenge(conn, "login", email, user["id"], {"remember": remember})
        forget(key)
        if not self.mail_code("login", email, user["name"], code):
            return self.send_json(502, self.NO_MAIL)
        return self.challenge_reply("login", email, cookie)

    def api_forgot(self, body):
        email = clean_text(body.get("email"), 254).lower()
        if not EMAIL_RE.match(email):
            return self.send_json(400, {"error": "Please enter a valid email address.", "field": "email"})
        if limited(("forgot", self.client_address[0]), 3600, 10) or self.mail_blocked(email):
            return self.send_json(429, self.TOO_MANY_MAILS)
        record(("forgot", self.client_address[0]))
        with db() as conn:
            user = conn.execute("SELECT * FROM users WHERE email = ? AND verified = 1", (email,)).fetchone()
            # Unknown addresses get an identical reply and a code that can never match, so accounts can't be probed.
            cookie, code = self.create_challenge(conn, "reset", email, user["id"] if user else None)
        if user and not self.mail_code("reset", email, user["name"], code):
            return self.send_json(502, self.NO_MAIL)
        return self.challenge_reply("reset", email, cookie)

    def api_challenge(self):
        with db() as conn:
            ch = self.current_challenge(conn)
        if not ch:
            return self.send_json(404, {"error": "This code has expired. Please start again."})
        wait = max(0, RESEND_AFTER - (int(time.time()) - ch["sent_at"]))
        return self.send_json(200, {
            "purpose": ch["purpose"], "email": mask_email(ch["email"]),
            "verified": bool(ch["verified"]), "resendIn": wait,
        })

    def api_verify(self, body):
        code = clean_text(body.get("code"), 12).replace(" ", "")
        clear = self.make_cookie(CHALLENGE_COOKIE, "", 0)
        with db() as conn:
            ch = self.current_challenge(conn)
            if not ch or ch["verified"]:
                return self.send_json(410, {"error": "This code has expired. Please request a new one."})
            if ch["attempts"] >= MAX_CODE_ATTEMPTS:
                return self.send_json(429, {"error": "Too many incorrect codes. Please request a new code."})
            right = ch["user_id"] is not None and CODE_RE.match(code) and int(time.time()) < ch["expires_at"] \
                and hmac.compare_digest(code_hash(ch["token_hash"], code), ch["code_hash"])
            if not right:
                conn.execute("UPDATE challenges SET attempts = attempts + 1 WHERE token_hash = ?", (ch["token_hash"],))
                left = MAX_CODE_ATTEMPTS - ch["attempts"] - 1
                message = "That code isn't right." + (f" {left} {'try' if left == 1 else 'tries'} left." if left else " Please request a new code.")
                return self.send_json(400, {"error": message, "field": "code"})
            if ch["purpose"] in ("signup", "reset"):
                # Email confirmed: the next step is choosing a password, within PASSWORD_STEP_SECONDS.
                conn.execute("UPDATE challenges SET verified = 1, expires_at = ? WHERE token_hash = ?",
                             (int(time.time()) + PASSWORD_STEP_SECONDS, ch["token_hash"]))
                return self.send_json(200, {"next": "password", "purpose": ch["purpose"]})
            data = json.loads(ch["data"])
            user = conn.execute("SELECT * FROM users WHERE id = ?", (ch["user_id"],)).fetchone()
            conn.execute("DELETE FROM challenges WHERE token_hash = ?", (ch["token_hash"],))
            session = self.start_session(conn, user["id"], data.get("remember", True))
        return self.send_json(200, {"next": "account", "user": public_user(user)}, [session, clear])

    def api_resend(self, body):
        with db() as conn:
            ch = self.current_challenge(conn)
            if not ch or ch["verified"]:
                return self.send_json(410, {"error": "This code has expired. Please start again."})
            wait = RESEND_AFTER - (int(time.time()) - ch["sent_at"])
            if wait > 0:
                return self.send_json(429, {"error": f"Please wait {wait} seconds before asking for a new code.", "resendIn": wait})
            if ch["sends"] >= MAX_SENDS or self.mail_blocked(ch["email"]):
                return self.send_json(429, self.TOO_MANY_MAILS)
            code = new_code()
            now = int(time.time())
            conn.execute(
                "UPDATE challenges SET code_hash = ?, attempts = 0, sends = sends + 1, sent_at = ?, expires_at = ? WHERE token_hash = ?",
                (code_hash(ch["token_hash"], code), now, now + CODE_SECONDS, ch["token_hash"]),
            )
            user = conn.execute("SELECT name FROM users WHERE id = ?", (ch["user_id"],)).fetchone() if ch["user_id"] else None
        if user and not self.mail_code(ch["purpose"], ch["email"], user["name"], code):
            return self.send_json(502, self.NO_MAIL)
        return self.send_json(200, {"ok": True, "email": mask_email(ch["email"]), "resendIn": RESEND_AFTER})

    def api_set_password(self, body):
        """Final step after a confirmed code: finishes a registration or resets a forgotten password."""
        password = body.get("password") if isinstance(body.get("password"), str) else ""
        with db() as conn:
            ch = self.current_challenge(conn)
            if not ch or ch["purpose"] not in ("signup", "reset") or not ch["verified"] or ch["user_id"] is None:
                return self.send_json(410, {"error": "This step has expired. Please start again to get a new code."})
            user = conn.execute("SELECT * FROM users WHERE id = ?", (ch["user_id"],)).fetchone()
            problem = password_problem(password, user["email"], user["name"])
            if problem:
                return self.send_json(400, {"error": problem, "field": "password"})
            conn.execute("UPDATE users SET password = ?, verified = 1 WHERE id = ?", (hash_password(password), user["id"]))
            conn.execute("DELETE FROM sessions WHERE user_id = ?", (user["id"],))  # sign out everywhere
            conn.execute("DELETE FROM challenges WHERE user_id = ?", (user["id"],))
            if ch["purpose"] == "signup" and json.loads(ch["data"]).get("newsletter"):
                conn.execute("INSERT OR IGNORE INTO subscribers (email, created_at) VALUES (?, ?)", (user["email"], int(time.time())))
            session = self.start_session(conn, user["id"], True)
        if ch["purpose"] == "reset":
            send_mail(user["email"], *password_changed_email(user["name"]))
        return self.send_json(200, {"purpose": ch["purpose"], "user": public_user(user)},
                              [session, self.make_cookie(CHALLENGE_COOKIE, "", 0)])

    def api_change_password(self, body):
        current = body.get("current") if isinstance(body.get("current"), str) else ""
        password = body.get("password") if isinstance(body.get("password"), str) else ""
        with db() as conn:
            user = self.current_user(conn)
            if not user:
                return self.send_json(401, {"error": "Please sign in again."})
            key = ("password", user["id"])
            if limited(key, LOGIN_WINDOW, 5):
                return self.send_json(429, {"error": "Too many attempts. Please wait a few minutes and try again."})
            if not check_password(current, user["password"]):
                record(key)
                return self.send_json(400, {"error": "Your current password isn't right.", "field": "current"})
            problem = password_problem(password, user["email"], user["name"])
            if problem:
                return self.send_json(400, {"error": problem, "field": "password"})
            if check_password(password, user["password"]):
                return self.send_json(400, {"error": "Choose a password you haven't used here before.", "field": "password"})
            conn.execute("UPDATE users SET password = ? WHERE id = ?", (hash_password(password), user["id"]))
            token = self.read_cookie(SESSION_COOKIE)
            conn.execute("DELETE FROM sessions WHERE user_id = ? AND token_hash != ?", (user["id"], token_hash(token)))
        send_mail(user["email"], *password_changed_email(user["name"]))
        return self.send_json(200, {"ok": True})

    def api_logout(self, body):
        token = self.read_cookie(SESSION_COOKIE)
        if token:
            with db() as conn:
                conn.execute("DELETE FROM sessions WHERE token_hash = ?", (token_hash(token),))
        return self.send_json(200, {"ok": True}, [self.make_cookie(SESSION_COOKIE, "", 0)])

    def api_logout_all(self, body):
        with db() as conn:
            user = self.current_user(conn)
            if user:
                conn.execute("DELETE FROM sessions WHERE user_id = ?", (user["id"],))
        return self.send_json(200, {"ok": True}, [self.make_cookie(SESSION_COOKIE, "", 0)])

    # Endpoints: shop

    def api_orders(self):
        with db() as conn:
            user = self.current_user(conn)
            if not user:
                return self.send_json(401, {"error": "Please sign in."})
            rows = conn.execute(
                "SELECT * FROM orders WHERE user_id = ? ORDER BY id DESC LIMIT 50", (user["id"],)
            ).fetchall()
        return self.send_json(200, {"orders": [order_view(r) for r in rows]})

    def api_place_order(self, body):
        lines = body.get("items")
        if not isinstance(lines, list) or not 1 <= len(lines) <= 20:
            return self.send_json(400, {"error": "Your bag is empty."})
        items, subtotal = [], 0
        for line in lines:
            if not isinstance(line, dict):
                return self.send_json(400, {"error": "Your bag couldn't be read."})
            product = CATALOG.get(line.get("slug"))
            size = line.get("size")
            qty = line.get("qty")
            if not product or size not in product[1] or not isinstance(qty, int) or not 1 <= qty <= 10:
                return self.send_json(400, {"error": "One of the items in your bag is no longer available."})
            price = product[1][size]
            items.append({"slug": line["slug"], "name": product[0], "size": size, "qty": qty, "price": price})
            subtotal += price * qty
        with db() as conn:
            user = self.current_user(conn)
            if not user:
                return self.send_json(401, {"error": "Please sign in to place your order."})
            cur = conn.execute(
                "INSERT INTO orders (user_id, items, subtotal, created_at) VALUES (?, ?, ?, ?)",
                (user["id"], json.dumps(items), subtotal, int(time.time())),
            )
            row = conn.execute("SELECT * FROM orders WHERE id = ?", (cur.lastrowid,)).fetchone()
        return self.send_json(201, {"order": order_view(row)})

    def api_contact(self, body):
        name = clean_text(body.get("name"), 80)
        email = clean_text(body.get("email"), 254).lower()
        topic = clean_text(body.get("topic"), 40)
        message = clean_text(body.get("message"), 4000)
        if not name:
            return self.send_json(400, {"error": "Please enter your name.", "field": "name"})
        if not EMAIL_RE.match(email):
            return self.send_json(400, {"error": "Please enter a valid email address.", "field": "email"})
        if topic not in CONTACT_TOPICS:
            return self.send_json(400, {"error": "Please choose a topic.", "field": "topic"})
        if len(message) < 10:
            return self.send_json(400, {"error": "Please write a little more so we can help.", "field": "message"})
        with db() as conn:
            conn.execute(
                "INSERT INTO messages (name, email, topic, message, created_at) VALUES (?, ?, ?, ?, ?)",
                (name, email, topic, message, int(time.time())),
            )
        return self.send_json(201, {"ok": True})

    def api_subscribe(self, body):
        email = clean_text(body.get("email"), 254).lower()
        if not EMAIL_RE.match(email):
            return self.send_json(400, {"error": "Please enter a valid email address."})
        with db() as conn:
            conn.execute(
                "INSERT OR IGNORE INTO subscribers (email, created_at) VALUES (?, ?)",
                (email, int(time.time())),
            )
        return self.send_json(200, {"ok": True})


def main():
    init_db()
    server = http.server.ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"Saomi is running at http://{HOST}:{PORT}  (Ctrl+C to stop)", flush=True)
    if MAIL_READY:
        print(f"[mail] Sending email through {SMTP_HOST} as {parseaddr(MAIL_FROM)[1]}", flush=True)
    else:
        print("[mail] Email isn't set up: codes are printed here and saved to data/outbox/. See .env.example.", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
