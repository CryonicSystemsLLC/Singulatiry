/**
 * Built-in Recipes Index
 *
 * Exports all built-in recipes for registration.
 */

import { authRecipe } from './auth';
import { crudRecipe } from './crud';
import { darkModeRecipe } from './dark-mode';
import type { Recipe } from '../types';

export const builtinRecipes: Recipe[] = [
  authRecipe,
  crudRecipe,
  darkModeRecipe
];

export { authRecipe, crudRecipe, darkModeRecipe };

export default builtinRecipes;
