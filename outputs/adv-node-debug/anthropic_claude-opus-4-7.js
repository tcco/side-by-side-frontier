// controllers/userController.js
const Joi = require('joi');
const db = require('../db'); // assume mysql2/promise pool

// 1. Strict input schema — prevents mass assignment
const updateSchema = Joi.object({
  firstName: Joi.string().trim().min(1).max(100),
  lastName:  Joi.string().trim().min(1).max(100),
  email:     Joi.string().email().max(255),
  bio:       Joi.string().max(1000).allow(''),
}).min(1); // at least one field required

// Fields that may NEVER be set via this endpoint
const FORBIDDEN_FIELDS = ['id', 'role', 'is_admin', 'password_hash', 'created_at'];

exports.updateProfile = async (req, res, next) => {
  try {
    // 2. AuthN/AuthZ — trust the authenticated session, NOT the body
    const authUserId = req.user?.id;
    if (!authUserId) {
      return res.status(401).json({ error: 'Unauthenticated' });
    }

    // Optional: allow admins to update others via :id param
    const targetUserId = Number(req.params.id ?? authUserId);
    if (!Number.isInteger(targetUserId) || targetUserId <= 0) {
      return res.status(400).json({ error: 'Invalid user id' });
    }
    if (targetUserId !== authUserId && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Forbidden' });
    }

    // 3. Validate & whitelist updates
    const { error, value: updates } = updateSchema.validate(req.body, {
      stripUnknown: true,
      abortEarly: false,
    });
    if (error) {
      return res.status(400).json({
        error: 'Validation failed',
        details: error.details.map(d => d.message),
      });
    }
    for (const key of FORBIDDEN_FIELDS) {
      if (key in updates) delete updates[key];
    }

    // 4. Single atomic UPDATE — no TOCTOU, no extra SELECT, parameterized
    //    Use affectedRows to determine existence.
    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();

      const [result] = await conn.query(
        'UPDATE users SET ? WHERE id = ?',
        [updates, targetUserId]
      );

      if (result.affectedRows === 0) {
        await conn.rollback();
        return res.status(404).json({ error: 'User not found' });
      }

      // 5. Return the updated row (single round-trip after commit)
      const [rows] = await conn.query(
        'SELECT id, firstName, lastName, email, bio, updated_at FROM users WHERE id = ?',
        [targetUserId]
      );

      await conn.commit();
      return res.status(200).json({ success: true, user: rows[0] });
    } catch (dbErr) {
      await conn.rollback();
      throw dbErr;
    } finally {
      conn.release();
    }
  } catch (err) {
    // 6. Delegate to centralized error middleware — no leaked stack traces
    next(err);
  }
};