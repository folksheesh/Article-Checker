const text = 'kewajiban\u00A0perubahan';
const escaped = 'kewajiban\\s+perubahan';
const re = new RegExp(escaped, 'i');
console.log("text has NBSP?", text.charCodeAt(9) === 160);
console.log("match:", re.exec(text));
