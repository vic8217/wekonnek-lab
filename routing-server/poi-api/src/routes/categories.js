/**
 * POI Categories endpoint
 * GET /categories
 */

const { query } = require('../db');

async function categoriesHandler(req, res) {
  try {
    const result = await query(`
      SELECT 
        category,
        subcategory,
        display_name,
        icon,
        (SELECT COUNT(*) FROM pois p 
         WHERE p.category = pc.category 
           AND (p.subcategory = pc.subcategory OR p.subcategory = pc.value)
        ) as count
      FROM poi_categories pc
      ORDER BY category, display_name
    `);

    // Group by category
    const grouped = {};
    for (const row of result.rows) {
      if (!grouped[row.category]) {
        grouped[row.category] = {
          category: row.category,
          subcategories: [],
        };
      }
      grouped[row.category].subcategories.push({
        subcategory: row.subcategory,
        display_name: row.display_name,
        icon: row.icon,
        count: parseInt(row.count) || 0,
      });
    }

    res.json({
      status: 'ok',
      categories: Object.values(grouped),
    });
  } catch (err) {
    console.error('Categories error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
}

module.exports = { categoriesHandler };
