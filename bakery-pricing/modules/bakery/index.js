// Bakery Pricing & Orders alan modulu: Orders · Recipes · Ingredients · Plan · Sales. Ekran cizimi views/ altindadir.
import { COLLECTIONS } from "./logic/schema.js";

export const id = "bakery";
export const screens = Object.freeze([{ id: "orders" }, { id: "recipes" }, { id: "ingredients" }, { id: "plan" }, { id: "sales" }]);
export const defaultScreen = "orders";
export const collections = COLLECTIONS;
export default { id, screens, defaultScreen, collections };
