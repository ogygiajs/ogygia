import { json } from '@sveltejs/kit';
import { categories } from '#lib/server/db.ts';

/** `GET /api/categories` → the category table (id, display name, position). */
export const GET = () => json(categories);
