const router = require('express').Router();
const audio = require('../controllers/audioController');

router.post('/download', (req, res) => audio.downloadFromYouTube(req, res));
router.post('/mix', (req, res) => audio.mixAudio(req, res));
router.delete('/file/:filename', (req, res) => audio.deleteFile(req, res));

module.exports = router;
