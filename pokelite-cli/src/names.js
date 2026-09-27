// Noms français aléatoires pour le profil (prénom/nom), repris de content.js.
export const FRENCH_FIRST_NAMES = [
  'Lucas', 'Emma', 'Louis', 'Léa', 'Hugo', 'Manon', 'Nathan', 'Chloé', 'Enzo', 'Camille',
  'Gabriel', 'Sarah', 'Raphaël', 'Inès', 'Jules', 'Louise', 'Adam', 'Jade', 'Arthur', 'Alice',
  'Maxime', 'Julie', 'Thomas', 'Clara', 'Antoine', 'Marie', 'Nicolas', 'Laura', 'Julien', 'Charlotte',
];

export const FRENCH_LAST_NAMES = [
  'Martin', 'Bernard', 'Dubois', 'Thomas', 'Robert', 'Richard', 'Petit', 'Durand', 'Leroy', 'Moreau',
  'Simon', 'Laurent', 'Lefebvre', 'Michel', 'Garcia', 'David', 'Bertrand', 'Roux', 'Vincent', 'Fournier',
  'Morel', 'Girard', 'André', 'Lefèvre', 'Mercier', 'Dupont', 'Lambert', 'Bonnet', 'François', 'Rousseau',
];

export function randomFrenchName() {
  return {
    firstName: FRENCH_FIRST_NAMES[Math.floor(Math.random() * FRENCH_FIRST_NAMES.length)],
    lastName: FRENCH_LAST_NAMES[Math.floor(Math.random() * FRENCH_LAST_NAMES.length)],
  };
}
