const router = require('express').Router();
const projects = require('../controllers/projectsController');

router.get('/', (req, res) => projects.list(req, res));
router.get('/:id', (req, res) => projects.get(req, res));
router.post('/', (req, res) => projects.save(req, res));
router.delete('/:id', (req, res) => projects.delete(req, res));

module.exports = router;
