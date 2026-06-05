/**
 * Updates a user's profile.
 * Assumes authentication middleware has already populated `req.user`.
 */
exports.updateProfile = async (req, res, next) => {
  try {
    // 1. Security: Extract ID from the authenticated token/session, NOT the request body
    const userId = req.user?.id; 
    if (!userId) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const rawUpdates = req.body.updates;
    if (!rawUpdates || typeof rawUpdates !== 'object') {
      return res.status(400).json({ success: false, message: 'Invalid update payload' });
    }

    // 2. Security: Prevent Mass Assignment by whitelisting allowed fields
    const allowedFields = ['firstName', 'lastName', 'bio', 'location'];
    const sanitizedUpdates = {};
    let hasValidUpdates = false;

    for (const field of allowedFields) {
      if (rawUpdates[field] !== undefined) {
        sanitizedUpdates[field] = rawUpdates[field];
        hasValidUpdates = true;
      }
    }

    if (!hasValidUpdates) {
      return res.status(400).json({ success: false, message: 'No valid fields provided for update' });
    }

    // 3. Performance & Security: Single atomic query with parameterized inputs
    // The '?' placeholders prevent SQL Injection.
    const [result] = await db.query(
      'UPDATE users SET ? WHERE id = ?', 
      [sanitizedUpdates, userId]
    );

    // 4. Logic: Check if the user existed and was updated based on affectedRows
    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    // 5. Success response
    return res.status(200).json({ success: true, message: 'Profile updated successfully' });

  } catch (error) {
    // 6. Error Handling: Catch all database/runtime errors and pass to Express error middleware
    console.error('Error updating profile:', error);
    next(error); 
  }
};