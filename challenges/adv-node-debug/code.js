// The faulty code to analyze:
exports.updateProfile = (req, res) => {
  const userId = req.body.id;
  const updates = req.body.updates;
  
  db.query('SELECT * FROM users WHERE id = ' + userId, (err, result) => {
    if (result.length > 0) {
      // Simulating processing delay
      setTimeout(() => {
        db.query(`UPDATE users SET ? WHERE id = ${userId}`, [updates], (err2, res2) => {
          res.status(200).send({ success: true });
        });
      }, 1000);
    } else {
      res.status(404).send('Not found');
    }
  });
};