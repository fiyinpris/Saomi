// The Saomi range: names and prices by slug.
// Orders are priced from this list, and the Firestore rules check every order against it.
// After changing it, run `python tools/build_firestore_rules.py` and publish firestore.rules.
export const CATALOG = {
  "soleil-dor": {
    "name": "Soleil d’Or",
    "prices": {
      "30 ml": 125,
      "50 ml": 185,
      "100 ml": 265
    }
  },
  "velours-noir": {
    "name": "Velours Noir",
    "prices": {
      "30 ml": 140,
      "50 ml": 205,
      "100 ml": 290
    }
  },
  "rose-imperiale": {
    "name": "Rose Impériale",
    "prices": {
      "30 ml": 120,
      "50 ml": 170,
      "100 ml": 245
    }
  },
  "verdant-obsession": {
    "name": "Verdant Obsession",
    "prices": {
      "30 ml": 115,
      "50 ml": 165,
      "100 ml": 240
    }
  },
  "lumiere-dopal": {
    "name": "Lumière d’Opal",
    "prices": {
      "30 ml": 110,
      "50 ml": 160,
      "100 ml": 230
    }
  },
  "santal-majeste": {
    "name": "Santal Majesté",
    "prices": {
      "30 ml": 135,
      "50 ml": 195,
      "100 ml": 280
    }
  },
  "aura-celeste": {
    "name": "Aura Céleste",
    "prices": {
      "30 ml": 105,
      "50 ml": 150,
      "100 ml": 215
    }
  },
  "elixir-de-nuit": {
    "name": "Élixir de Nuit",
    "prices": {
      "30 ml": 150,
      "50 ml": 215,
      "100 ml": 305
    }
  },
  "jasmin-eternel": {
    "name": "Jasmin Éternel",
    "prices": {
      "30 ml": 130,
      "50 ml": 190,
      "100 ml": 270
    }
  },
  "cuir-imperial": {
    "name": "Cuir Impérial",
    "prices": {
      "30 ml": 155,
      "50 ml": 225,
      "100 ml": 320
    }
  },
  "nectar-dor": {
    "name": "Nectar d’Or",
    "prices": {
      "30 ml": 135,
      "50 ml": 195,
      "100 ml": 280
    }
  },
  "ombre-rose": {
    "name": "Ombre Rose",
    "prices": {
      "30 ml": 145,
      "50 ml": 210,
      "100 ml": 300
    }
  },
  "fleur-sauvage": {
    "name": "Fleur Sauvage",
    "prices": {
      "30 ml": 115,
      "50 ml": 165,
      "100 ml": 240
    }
  },
  "ocean-infini": {
    "name": "Océan Infini",
    "prices": {
      "30 ml": 110,
      "50 ml": 160,
      "100 ml": 230
    }
  },
  "bois-de-cashmere": {
    "name": "Bois de Cashmere",
    "prices": {
      "30 ml": 125,
      "50 ml": 180,
      "100 ml": 260
    }
  }
};
