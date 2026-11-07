'use strict';
// Données du festival. Source : listenfestival.be (/program, /locations, /listen-express), relevé du 07/11/2026.
// Coordonnées : OpenStreetMap (Nominatim), sauf Congrès (approximatif, marqué approx).
// s / e : heures depuis samedi 00:00 (14 = sam. 14:00, 30 = dim. 06:00, 38 = dim. 14:00).
// k : club (nuit), jour (club ouvert en journée), disq (disquaire).
// osm : adresse trouvée dans OpenStreetMap, pas sur le site du festival.
const V = [
  { id: 'hexagon', n: 'Hexagon', k: 'club', lat: 50.84885, lng: 4.36189, s: 20, e: 30,
    a: 'Rue de Ligne 8, 1000 Bruxelles',
    ar: ['Border One', 'CJ Bolland B2B Mary Lake', 'Clara D', 'Malo Z'] },
  { id: 'congres', n: 'Congrès Station', k: 'club', approx: true, lat: 50.8528, lng: 4.3623, s: 22, e: 29,
    a: 'Gare de Bruxelles-Congrès (adresse non publiée)',
    ar: ['FAISAL', 'Kaâm', 'KŌMA', 'Mikamayonnaise'] },
  { id: 'central', n: 'Central Station', k: 'club', lat: 50.8456, lng: 4.3567, s: 22, e: 29,
    a: "Carrefour de l'Europe, 1000 Bruxelles",
    ar: ['Kirollus (All-night Long)'] },
  { id: 'nord', n: 'North Station', k: 'club', lat: 50.86038, lng: 4.36008, s: 22, e: 29,
    a: 'Rue du Progrès 76, 1030 Bruxelles',
    ar: ['Avalon Emerson', 'Otis', 'Tiga', 'UNOS'] },
  { id: 'c12', n: 'C12', k: 'club', lat: 50.84603, lng: 4.35584, s: 21, e: 31,
    a: 'Rue du Marché aux Herbes 116, 1000 Bruxelles',
    ar: ['Gabber Eleganza', 'Haumea', 'Hysope', "Lolalita & Brennt 'Live'", 'MYU:SA', 'NMSS', 'séa', 'Warhaus: Ha Ha Heartbeats', 'Zora Jones'] },
  { id: 'fuse', n: 'Fuse', k: 'club', lat: 50.83539, lng: 4.34468, s: 23, e: 32,
    a: 'Rue Blaes 208, 1000 Bruxelles',
    ar: ['BAVR & DC Noises', 'CYVIRA', 'LAURAVIOLI', 'Maraskino', 'Miss Bashful', 'MCR-T', 'Stella K'] },
  { id: 'blur', n: 'Blur (UMI)', k: 'jour', lat: 50.84585, lng: 4.35304, s: 23, e: 38,
    a: 'Rue du Marché aux Fromages 10, 1000 Bruxelles',
    ar: ['Amelia Holt', 'Casper', 'DJ Rino', 'Nosedrip', 'tINI', 'Tori Ann'] },
  { id: 'citygate', n: 'Studio CityGate & La Fabriek', k: 'jour', tbc: true, lat: 50.83159, lng: 4.32208, s: 23, e: 38,
    a: 'Rue de la Petite-Île 1A, 1070 Anderlecht',
    ar: ['Acidheaven', 'Adi', "Angel D'Lite", 'Disconsole', 'DJ Miss Parker', 'Eclectic Elektra', 'Francesco Del Garda B2B Virginia', 'Joe Delon', 'Jorkes', 'Lea Occhi', 'Mike Servito', 'Running Hot', 'Sixsixsixties B2B Fais Le Beau', 'Vuur'] },
  { id: 'standard', n: 'The Standard Greenhouse', k: 'jour', lat: 50.86203, lng: 4.35771, s: 16, e: 29,
    a: 'Boulevard du Roi Albert II 30, 1000 Bruxelles',
    ar: ['Antal B2B Lefto Early Bird', 'She The Dj B2B EG', 'Suze Ijó B2B DTM Funk'] },
  { id: 'quadri', n: 'Quadrilatères (Midi)', k: 'jour', lat: 50.83536, lng: 4.3372, s: 16, e: 28,
    a: 'Avenue Fonsny 47B, 1060 Saint-Gilles',
    ar: ['Dub Punishers', 'Dillinja', 'Kode 9 B2B Tim Reaper', 'Lou Nour B2B Introspekt', 'Mala', 'Vers B2B Pala10'] },
  { id: 'crevette', n: 'Crevette Records', k: 'disq', osm: true, lat: 50.83786, lng: 4.34756, s: 14, e: 20,
    a: 'Rue Blaes, Marolles',
    ar: ['DJ Rino', 'Nina Welch', 'Nosedrip'] },
  { id: 'r72', n: '72 Records', k: 'disq', osm: true, lat: 50.84574, lng: 4.34949, s: 14, e: 20,
    a: 'Rue du Midi 72, 1000 Bruxelles',
    ar: ["Grandma's Special", 'Kamerkaai/Moslty Interrupted', 'Teresa Ye/Slow Ye Down'] },
  { id: 'sono', n: 'Sono Ventura', k: 'disq', osm: true, lat: 50.83829, lng: 4.34979, s: 14, e: 20,
    a: 'Rue Haute 153, 1000 Bruxelles',
    ar: ['Amelia Holt', 'Malo Z', 'Sookie'] },
  { id: 'doctor', n: 'Doctor Vinyl', k: 'disq', osm: true, lat: 50.84762, lng: 4.34692, s: 14, e: 20,
    a: 'Rue de la Grande Île, 1000 Bruxelles',
    ar: ['Doc V. B2B Olivier Abbeloos', 'Flore', 'Jojomojo'] },
  { id: 'tropicall', n: 'Tropicall Records', k: 'disq', osm: true, lat: 50.83669, lng: 4.34812, s: 14, e: 20,
    a: 'Rue Haute 235, 1000 Bruxelles',
    ar: ['Ben Thé', 'Charlotte Pépé', 'DJ Lovepills'] },
];

const EXPRESS = { n: 'Listen Express', s: 24, e: 29 };

// Les quatre gares du Listen Express et du plan. Les 3 premières sont aussi des lieux.
const GARES = {
  nord: { id: 'g-nord', n: 'Gare du Nord', lat: 50.86038, lng: 4.36008 },
  congres: { id: 'g-congres', n: 'Gare du Congrès', lat: 50.8528, lng: 4.3623 },
  central: { id: 'g-central', n: 'Gare Centrale', lat: 50.8456, lng: 4.3567 },
  midi: { id: 'g-midi', n: 'Gare du Midi', lat: 50.83595, lng: 4.33685 },
};

// Goûts de Mahx
const T = {
  pick: ['MCR-T', 'CJ Bolland B2B Mary Lake', 'Avalon Emerson', 'UNOS', 'Mike Servito', 'Tiga', 'Border One'],
  check: ['Maraskino', 'Miss Bashful', 'BAVR & DC Noises', 'LAURAVIOLI', 'CYVIRA', 'Clara D', 'Malo Z', 'Otis', 'Haumea', 'tINI'],
  skip: ['Gabber Eleganza', 'Dillinja', 'Mala', 'Kode 9 B2B Tim Reaper', 'Dub Punishers'],
};
const TAG_TXT = { pick: 'Incontournable', check: 'À écouter', skip: 'Pas pour moi' };

// Parcours proposé. h : heure (depuis sam. 00:00). leg : trajet à pied calculé dans le site.
const ROUTE = [
  { h: 20, id: 'hexagon', titre: 'Hexagon',
    txt: "Ouverture à 20:00 : le lieu qui commence le plus tôt de tes coups de cœur. Arrivée par la Gare Centrale.",
    leg: { from: 'g-central', to: 'hexagon' }, train: 'Train jusqu’à Bruxelles-Central (SNCB, horaires à vérifier), puis à pied.' },
  { h: 22.5, id: 'nord', titre: 'North Station',
    txt: 'Ouverture à 22:00. Avalon Emerson, Tiga et UNOS dans le hall de la gare.',
    leg: { from: 'hexagon', to: 'nord' } },
  { h: 24, id: 'express', titre: 'Listen Express, Nord → Midi',
    txt: 'Le train-fête part de la gare où tu es déjà. Descends à Midi. Horaire des passages pas encore publié.',
    leg: null },
  { h: 25.5, id: 'fuse', titre: 'Fuse',
    txt: 'Ouvert jusqu’à 08:00 : MCR-T et une bonne partie de ta liste « à écouter ».',
    leg: { from: 'g-midi', to: 'fuse' } },
];

// Couleurs proposées aux potes (le serveur accepte exactement cette liste)
const COLORS = ['#f5b800', '#57c4d1', '#ff6b6b', '#7bd36b', '#c08bff', '#ff9f4a', '#4f8dff', '#ff7ac6', '#b8c23a', '#e8e8e8'];

// Statuts rapides (identiques à ceux du serveur, un test le vérifie)
const STATUS = ['Au bar', 'Dans la file', 'Je danse', 'Je mange', 'Je vous cherche', 'Je rentre', 'Je suis perdu'];

const QUICK =['Je suis arrivé', 'Vous êtes où ?', 'On bouge ?', "J'ai soif", 'Venez, c’est dingue ici', 'Je rentre'];
