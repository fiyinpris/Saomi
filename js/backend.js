// Accounts, orders, contact messages and newsletter sign-ups, backed by Firebase.
// js/main.js calls these through api('/api/<name>', body). Each returns plain data, or throws an
// Error carrying { status, field, retry } so the pages can show the message next to the right field.
//
// Sign-up: name + email -> Firebase emails a confirmation link -> once it's opened, the visitor
// creates their password. Until then the account holds a random password nobody knows, so an
// unfinished sign-up can't be used to sign in.

import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js';
import {
  getAuth, connectAuthEmulator, setPersistence, browserLocalPersistence, browserSessionPersistence,
  createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, sendEmailVerification,
  sendPasswordResetEmail, updateProfile, updatePassword, reauthenticateWithCredential,
  EmailAuthProvider, applyActionCode, verifyPasswordResetCode, confirmPasswordReset,
} from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js';
import { firebaseConfig } from './firebase-config.js';
import { CATALOG } from './catalog.js';

const FIRESTORE_SDK = 'https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js';
const LOCAL = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const TOPICS = ['Order', 'Product advice', 'Gifting', 'Other'];
const RESEND_SECONDS = 60;
const MAX_LINES = 15; // different items per order; firestore.rules uses the same limit
const PENDING_KEY = 'saomi-signup';
const PENDING_TTL = 24 * 60 * 60 * 1000;
const COMMON = ['password', 'password1', 'password123', '12345678', '123456789', 'qwerty123', 'iloveyou1', 'saomi123', 'perfume1', 'perfume123'];

// Local testing only: localStorage 'saomi-emulator' = 'auth' (Authentication emulator) or 'all'.
let EMULATOR = '';
try { EMULATOR = LOCAL ? localStorage.getItem('saomi-emulator') || '' : ''; } catch (e) { /* storage blocked */ }
const config = EMULATOR ? { apiKey: 'demo-key', authDomain: 'localhost', projectId: 'demo-saomi' } : firebaseConfig;

const app = config ? initializeApp(config) : null;
const auth = app ? getAuth(app) : null;
if (auth && EMULATOR) connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });

const NOT_READY = LOCAL
  ? 'Firebase isn’t connected yet. Add your project’s settings to js/firebase-config.js.'
  : 'Sign-in and accounts aren’t available right now. Please try again later.';
const NETWORK = 'We couldn’t reach Saomi. Check your connection and try again.';

// ---------- Helpers ----------

function fail(status, message, extra = {}) {
  return Object.assign(new Error(message), { status }, extra);
}

const clean = (value, max) => (typeof value === 'string' ? value.trim().slice(0, max) : '');
const own = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

function friendly(err) {
  const code = (err && err.code) || '';
  if (LOCAL) console.warn('[saomi]', code || err); // eslint-disable-line no-console
  switch (code) {
    case 'auth/email-already-in-use':
      return fail(409, 'An account with this email already exists. Please sign in, or use “Forgot password” if you never finished setting it up.', { field: 'email' });
    case 'auth/invalid-email':
      return fail(400, 'Please enter a valid email address.', { field: 'email' });
    case 'auth/invalid-credential':
    case 'auth/invalid-login-credentials':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
      return fail(401, 'That email and password don’t match. Please try again.', { field: 'password' });
    case 'auth/too-many-requests':
      return fail(429, 'Too many attempts. Please wait a few minutes and try again.');
    case 'auth/weak-password':
    case 'auth/password-does-not-meet-requirements':
      return fail(400, 'Please choose a stronger password.', { field: 'password' });
    case 'auth/expired-action-code':
    case 'auth/invalid-action-code':
      return fail(410, 'This link has expired or has already been used.');
    case 'auth/user-disabled':
      return fail(403, 'This account has been switched off. Please contact us.');
    case 'auth/requires-recent-login':
    case 'auth/user-token-expired':
      return fail(401, 'For your security, please sign in again.');
    case 'auth/operation-not-allowed':
    case 'auth/configuration-not-found':
      return fail(503, LOCAL ? 'Turn on Email/Password in Firebase (Authentication > Get started > Sign-in method).' : NOT_READY);
    case 'auth/unauthorized-domain':
    case 'auth/unauthorized-continue-uri':
    case 'auth/invalid-continue-uri':
      return fail(503, LOCAL ? 'Add this site’s domain in Firebase (Authentication > Settings > Authorized domains).' : NOT_READY);
    case 'auth/network-request-failed':
    case 'unavailable':
      return fail(0, NETWORK);
    case 'permission-denied':
      return fail(403, 'That didn’t go through. Please sign in again and retry.');
    default:
      return fail(500, 'Something went wrong. Please try again.');
  }
}

function checkPassword(pw, email = '', name = '') {
  if (typeof pw !== 'string' || pw.length < 8) throw fail(400, 'Your password needs at least 8 characters.', { field: 'password' });
  if (pw.length > 128) throw fail(400, 'Please use 128 characters or fewer.', { field: 'password' });
  if (!(/[a-z]/i.test(pw) && /\d/.test(pw))) throw fail(400, 'Use at least one letter and one number in your password.', { field: 'password' });
  const lower = pw.toLowerCase();
  const local = email.split('@')[0].toLowerCase();
  const first = name.trim().split(/\s+/)[0].toLowerCase();
  if (COMMON.includes(lower) || (local.length >= 4 && lower.includes(local)) || (first.length >= 4 && lower.includes(first))) {
    throw fail(400, 'That password is too easy to guess. Please choose another.', { field: 'password' });
  }
}

function tempPassword() {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return `Sa1!${btoa(String.fromCharCode(...bytes)).replace(/[+/=]/g, '')}`;
}

// Links in Firebase's emails bring the visitor back to this site.
const linkBack = (page) => ({ url: new URL(page, location.href).href });

function publicUser(user) {
  return {
    name: user.displayName || user.email.split('@')[0],
    email: user.email,
    createdAt: Math.round((Date.parse(user.metadata.creationTime) || Date.now()) / 1000),
  };
}

// The unfinished sign-up lives in this browser so the tab opened from the email can carry on.
let memoryPending = null;
function readPending() {
  let p = memoryPending;
  try { p = JSON.parse(localStorage.getItem(PENDING_KEY) || 'null'); } catch (e) { /* storage blocked */ }
  if (p && Date.now() - p.startedAt < PENDING_TTL) return p;
  clearPending();
  return null;
}
function writePending(p) {
  memoryPending = p;
  try { localStorage.setItem(PENDING_KEY, JSON.stringify(p)); } catch (e) { /* storage blocked */ }
}
function clearPending() {
  memoryPending = null;
  try { localStorage.removeItem(PENDING_KEY); } catch (e) { /* storage blocked */ }
}

async function pendingUser() {
  await auth.authStateReady();
  const p = readPending();
  const user = auth.currentUser;
  if (!p || !user || user.uid !== p.uid) throw fail(410, 'This sign-up has expired. Please start again.');
  return { p, user };
}

async function signedIn() {
  await auth.authStateReady();
  const user = auth.currentUser;
  if (!user || !user.emailVerified) throw fail(401, 'Please sign in first.');
  return user;
}

let storePromise;
function store() {
  storePromise = storePromise || import(FIRESTORE_SDK).then((fs) => {
    const db = fs.getFirestore(app);
    if (EMULATOR === 'all') fs.connectFirestoreEmulator(db, '127.0.0.1', 8085);
    return { fs, db };
  });
  return storePromise;
}

async function addSubscriber(raw) {
  const email = clean(raw, 254).toLowerCase();
  if (!EMAIL.test(email)) throw fail(400, 'Please enter a valid email address.', { field: 'email' });
  const { fs, db } = await store();
  await fs.setDoc(fs.doc(db, 'subscribers', email), { email, createdAt: fs.serverTimestamp() });
}

function orderNumber() {
  const bytes = new Uint8Array(2);
  crypto.getRandomValues(bytes);
  return `SA-${Date.now().toString(36).toUpperCase()}${[...bytes].map((b) => (b % 36).toString(36)).join('').toUpperCase()}`;
}

// ---------- Calls ----------

const handlers = {
  async me() {
    await auth.authStateReady();
    const user = auth.currentUser;
    const p = readPending();
    if (!user) { if (p) clearPending(); return { user: null }; }
    if ((p && p.uid === user.uid) || !user.emailVerified) return { user: null }; // not finished
    return { user: publicUser(user) };
  },

  // Step 1: name + email. Creates the account and emails the confirmation link.
  async signup(body) {
    const name = clean(body.name, 80);
    const email = clean(body.email, 254).toLowerCase();
    if (!name) throw fail(400, 'Please enter your full name.', { field: 'name' });
    if (!EMAIL.test(email)) throw fail(400, 'Please enter a valid email address.', { field: 'email' });
    await auth.authStateReady();
    if (auth.currentUser) await signOut(auth);
    clearPending();
    await setPersistence(auth, browserLocalPersistence);
    const temp = tempPassword();
    const { user } = await createUserWithEmailAndPassword(auth, email, temp);
    writePending({ uid: user.uid, email, name, temp, newsletter: !!body.newsletter, startedAt: Date.now(), sentAt: 0 });
    await updateProfile(user, { displayName: name });
    try {
      await sendEmailVerification(user, linkBack('verify.html'));
      writePending({ ...readPending(), sentAt: Date.now() });
    } catch (err) { /* the next page offers "send a new link" */ }
    return { next: 'verify', purpose: 'signup', email };
  },

  // The confirmation page: who we're waiting for, and whether they've opened the link yet.
  async challenge() {
    const { p, user } = await pendingUser();
    await user.reload().catch(() => {});
    const resendIn = Math.max(0, Math.ceil((p.sentAt + RESEND_SECONDS * 1000 - Date.now()) / 1000));
    return { purpose: 'signup', email: p.email, verified: user.emailVerified, resendIn };
  },

  async check() {
    const { user } = await pendingUser();
    await user.reload();
    return { verified: user.emailVerified };
  },

  async resend() {
    const { p, user } = await pendingUser();
    const wait = Math.ceil((p.sentAt + RESEND_SECONDS * 1000 - Date.now()) / 1000);
    if (wait > 0) throw fail(429, `Please wait ${wait}s before asking for another link.`, { retry: wait });
    await sendEmailVerification(user, linkBack('verify.html'));
    writePending({ ...p, sentAt: Date.now() });
    return { resendIn: RESEND_SECONDS };
  },

  // A confirmation link opened on this site (when the Firebase email action URL points here).
  async applyCode(body) {
    await auth.authStateReady();
    const mine = () => {
      const p = readPending();
      return p && auth.currentUser && auth.currentUser.uid === p.uid;
    };
    try {
      await applyActionCode(auth, clean(body.code, 2000));
    } catch (err) {
      // The same link opened twice: fine if this browser's sign-up is already confirmed.
      if (mine()) {
        await auth.currentUser.reload().catch(() => {});
        if (auth.currentUser.emailVerified) return { continue: true };
      }
      throw err;
    }
    if (!mine()) return { continue: false };
    await auth.currentUser.reload();
    return { continue: true };
  },

  // Step 3: the email is confirmed; replace the random password with theirs.
  async setPassword(body) {
    const { p, user } = await pendingUser();
    await user.reload();
    if (!user.emailVerified) throw fail(409, 'Please confirm your email first, using the link we sent you.');
    checkPassword(body.password, p.email, p.name);
    await reauthenticateWithCredential(user, EmailAuthProvider.credential(p.email, p.temp));
    await updatePassword(user, body.password);
    await user.getIdToken(true); // the database sees the confirmed email straight away
    clearPending();
    if (p.newsletter) await addSubscriber(p.email).catch(() => {});
    return { purpose: 'signup', user: publicUser(user) };
  },

  async login(body) {
    const email = clean(body.email, 254).toLowerCase();
    if (!EMAIL.test(email)) throw fail(400, 'Please enter a valid email address.', { field: 'email' });
    if (!body.password) throw fail(400, 'Please enter your password.', { field: 'password' });
    await auth.authStateReady();
    await setPersistence(auth, body.remember ? browserLocalPersistence : browserSessionPersistence);
    const { user } = await signInWithEmailAndPassword(auth, email, body.password);
    const p = readPending();
    if (p && p.uid === user.uid) clearPending(); // finished another way (e.g. "Forgot password")
    if (!user.emailVerified) {
      await sendEmailVerification(user, linkBack('login.html')).catch(() => {});
      await signOut(auth);
      throw fail(403, 'Please confirm your email address first. We’ve sent you a new link: open it, then sign in again.');
    }
    return { next: 'account', user: publicUser(user) };
  },

  async forgot(body) {
    const email = clean(body.email, 254).toLowerCase();
    if (!EMAIL.test(email)) throw fail(400, 'Please enter a valid email address.', { field: 'email' });
    try {
      await sendPasswordResetEmail(auth, email, linkBack('login.html'));
    } catch (err) {
      if (err.code !== 'auth/user-not-found') throw err; // never reveal which emails have accounts
    }
    return { sent: true };
  },

  // A password-reset link opened on this site.
  async resetCheck(body) {
    return { email: await verifyPasswordResetCode(auth, clean(body.code, 2000)) };
  },

  async resetPassword(body) {
    const code = clean(body.code, 2000);
    const email = await verifyPasswordResetCode(auth, code);
    checkPassword(body.password, email);
    await confirmPasswordReset(auth, code, body.password);
    clearPending();
    await setPersistence(auth, browserLocalPersistence);
    const { user } = await signInWithEmailAndPassword(auth, email, body.password);
    return { purpose: 'reset', user: publicUser(user) };
  },

  // Change password from My account. Firebase signs out other devices when it changes.
  async password(body) {
    const user = await signedIn();
    if (!body.current) throw fail(400, 'Please enter your current password.', { field: 'current' });
    checkPassword(body.password, user.email, user.displayName || '');
    if (body.current === body.password) throw fail(400, 'Choose a password that’s different from your current one.', { field: 'password' });
    try {
      await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, body.current));
    } catch (err) {
      if (['auth/invalid-credential', 'auth/invalid-login-credentials', 'auth/wrong-password'].includes(err.code)) {
        throw fail(400, 'Your current password isn’t right.', { field: 'current' });
      }
      throw err;
    }
    await updatePassword(user, body.password);
    return { ok: true };
  },

  async logout() {
    clearPending();
    await signOut(auth);
    return { ok: true };
  },

  // GET: this account's orders. POST: place one, priced from the catalogue (the rules check it too).
  async orders(body) {
    const user = await signedIn();
    const { fs, db } = await store();
    if (body === undefined) {
      const snap = await fs.getDocs(fs.query(fs.collection(db, 'orders'), fs.where('uid', '==', user.uid), fs.limit(100)));
      const orders = snap.docs.map((d) => {
        const o = d.data();
        return { number: o.number, subtotal: o.subtotal, items: o.items, createdAt: o.createdAt ? o.createdAt.seconds : Date.now() / 1000 };
      }).sort((a, b) => b.createdAt - a.createdAt);
      return { orders };
    }
    const lines = (Array.isArray(body.items) ? body.items : []).map(({ slug, size, qty }) => {
      const product = own(CATALOG, slug) ? CATALOG[slug] : null;
      if (!product || !own(product.prices, size) || !Number.isInteger(qty) || qty < 1 || qty > 10) {
        throw fail(400, 'One of the items in your bag is no longer available.');
      }
      return { slug, name: product.name, size, qty, price: product.prices[size] };
    });
    if (!lines.length) throw fail(400, 'Your bag is empty.');
    if (lines.length > MAX_LINES) throw fail(400, `Please order up to ${MAX_LINES} different items at a time.`);
    const subtotal = lines.reduce((sum, l) => sum + l.price * l.qty, 0);
    const number = orderNumber();
    await fs.addDoc(fs.collection(db, 'orders'), {
      uid: user.uid,
      email: user.email,
      name: (user.displayName || user.email).slice(0, 80),
      number,
      items: lines,
      subtotal,
      createdAt: fs.serverTimestamp(),
    });
    return { order: { number, subtotal, items: lines, createdAt: Date.now() / 1000 } };
  },

  async contact(body) {
    const data = {
      name: clean(body.name, 80),
      email: clean(body.email, 254),
      topic: clean(body.topic, 40),
      message: clean(body.message, 4000),
    };
    if (!data.name) throw fail(400, 'Please enter your name.', { field: 'name' });
    if (!EMAIL.test(data.email)) throw fail(400, 'Please enter a valid email address.', { field: 'email' });
    if (!TOPICS.includes(data.topic)) throw fail(400, 'Please choose a topic.', { field: 'topic' });
    if (data.message.length < 10) throw fail(400, 'Please write a little more so we can help.', { field: 'message' });
    await auth.authStateReady();
    const { fs, db } = await store();
    if (auth.currentUser && auth.currentUser.emailVerified) data.uid = auth.currentUser.uid;
    await fs.addDoc(fs.collection(db, 'messages'), { ...data, createdAt: fs.serverTimestamp() });
    return { ok: true };
  },

  async subscribe(body) {
    await addSubscriber(body.email);
    return { ok: true };
  },
};

// '/api/set-password' -> handlers.setPassword
export async function call(path, body) {
  const name = path.replace(/^\/api\//, '').replace(/-([a-z])/g, (_, c) => c.toUpperCase());
  if (!own(handlers, name)) throw fail(404, 'Not found.');
  if (!auth) throw fail(503, NOT_READY);
  try {
    return await handlers[name](body);
  } catch (err) {
    throw err && typeof err.status === 'number' ? err : friendly(err);
  }
}
