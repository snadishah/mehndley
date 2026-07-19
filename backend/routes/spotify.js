const router = require('express').Router();
const spotify = require('../controllers/spotifyController');

router.get('/search', (req, res) => spotify.search(req, res));
router.get('/features', (req, res) => spotify.getAudioFeatures(req, res));
router.get('/suggestions/:trackId', (req, res) => spotify.getSuggestions(req, res));

module.exports = router;
