const { serializeDOMToMarkdown } = require('./dist/src/adapters/dom-serializer.js');

// Simulate in Node with JSDOM
const { JSDOM } = require('jsdom');
const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
global.document = dom.window.document;
global.Node = dom.window.Node;

const huge = '<p>' + 'x '.repeat(40000) + '</p>';
document.body.innerHTML = huge;
const md = serializeDOMToMarkdown();
console.log('Output length:', md.length);
console.log('First 200 chars:', md.substring(0, 200));
console.log('Last 100 chars:', md.substring(md.length - 100));
