const fs = require('fs');
const App = fs.readFileSync('./src/App.tsx', 'utf8');

const applyHighlights = App.match(/const applyHighlights = \([^)]*\) => {([\s\S]*?)};\s*\/\/\s*applyHighlights/);
// Wait, regex might be hard. Let's just find the code.
