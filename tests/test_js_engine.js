/**
 * PromptTrim JS Engine Unit Test Suite (Node.js native runner).
 * Validates tokenizer, instruction detector, diff generator, and compression engine.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

// Setup mock browser globals for pure JS loading
const ctx = {
  window: {},
  console: console,
  Math: Math,
  RegExp: RegExp,
  Array: Array,
  Object: Object,
  String: String,
  Number: Number,
  Date: Date,
  JSON: JSON
};
vm.createContext(ctx);

// Helper to load extension files into context
function loadScript(relPath) {
  const code = fs.readFileSync(path.join(__dirname, '..', 'extension', relPath), 'utf8');
  vm.runInContext(code, ctx);
}

loadScript('tokenizer.js');
loadScript('instruction-detector.js');
loadScript('diff.js');
loadScript('engine.js');

const { Tokenizer, InstructionDetector, Diff, PromptTrim } = ctx.window;

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    passed++;
    console.log(`  \x1b[32m✔\x1b[0m ${message}`);
  } else {
    failed++;
    console.error(`  \x1b[31m✖\x1b[0m ${message}`);
  }
}

console.log('\n--- 1. Testing Tokenizer (Tokenizer) ---');
const sampleText = 'The quick brown fox jumps over the lazy dog. 12345 {"key": "value"}';
const count = Tokenizer.countTokens(sampleText, 'gpt-4o');
assert(count > 0, `Count tokens returned: ${count}`);
assert(count >= 10, 'Accurately counts complex punctuation and JSON');

const codeSample = '```javascript\nfunction test(x) { return x * 2; }\n```';
const codeTokens = Tokenizer.countTokens(codeSample, 'gpt-4o');
assert(codeTokens >= 8, `Code block token count (${codeTokens}) reflects syntax tokens`);

const batchCounts = Tokenizer.countTokensBatch(['hello world', 'a quick test string', 'another long sentence with multiple words'], 'gpt-4o');
assert(batchCounts.length === 3 && batchCounts[2] > batchCounts[0], 'countTokensBatch processes multiple strings correctly');

console.log('\n--- 2. Testing Instruction Detector (InstructionDetector) ---');
const instruction1 = 'Please optimize the database queries.';
const constraint1 = 'Make sure to keep latency below 50ms.';
const context1 = 'The weather in Seattle is rainy.';
const format1 = 'You must return JSON format only.';

assert(InstructionDetector.isCritical(instruction1), 'Detected "Please optimize..." as critical/instruction');
assert(InstructionDetector.isCritical(constraint1), 'Detected "Make sure..." as critical/constraint');
assert(!InstructionDetector.isCritical(context1), 'Detected weather sentence as non-critical context');
assert(InstructionDetector.isCritical(format1), 'Detected "You must return..." as critical output format');

const density = InstructionDetector.density([instruction1, constraint1, context1, format1]);
assert(density === 0.75, `Instruction density correctly computed (0.75): ${density}`);

console.log('\n--- 3. Testing Diff Engine (Diff) ---');
const original = 'Hello world, this is a test prompt with extra redundant tokens.';
const compressed = 'Hello world, this test prompt has tokens.';
const diffWords = Diff.diffWords(original, compressed);
assert(diffWords.length > 0, 'Word diff generated');
assert(diffWords.some(d => d.type === 'removed'), 'Diff detects removed tokens');
assert(diffWords.some(d => d.type === 'context'), 'Diff detects preserved context tokens');

const diffHtml = Diff.renderDiffHtml(diffWords);
assert(diffHtml.includes('td-diff-del') && diffHtml.includes('td-diff-ctx'), 'Renders formatted diff HTML');

console.log('\n--- 4. Testing End-to-End Compression Engine (PromptTrim) ---');
const testDoc = `
Overview of the project.
This document explains the core architecture.
Please make sure the API returns HTTP 200 on success.
Furthermore, it should be noted that we also consider other factors.
Do not delete the authentication header under any circumstance.
Here is the implementation:
\`\`\`python
def execute():
    return True
\`\`\`
Thank you very much for reading.
`;

const res = PromptTrim.compress(testDoc, 'API response rules', {
  keepFraction: 0.5,
  fidelityMode: true,
  profile: 'chat-prompt'
});

assert(res.compressed.length > 0, 'Produces non-empty compressed text');
assert(res.tokensSaved > 0, `Tokens saved calculated: ${res.tokensSaved} tokens`);
assert(res.reductionPercent > 0, `Reduction percentage > 0: ${res.reductionPercent}%`);
assert(res.compressed.includes('HTTP 200') || res.compressed.includes('authentication header'), 'Preserves critical constraints under fidelity mode');
assert(res.compressed.includes('```python'), 'Atomic code block protected from truncation');

console.log('\n--- 5. Testing Anaphora Recovery & Profile Weights ---');
const anaphoraText = `
The server encountered a timeout error.
It failed to respond within the 30-second window.
The weather was sunny outside.
`;
const anaphoraRes = PromptTrim.compress(anaphoraText, 'server timeout', {
  keepFraction: 0.5,
  fidelityMode: true,
  profile: 'chat-prompt'
});
assert(anaphoraRes.compressed.includes('The server encountered a timeout error.'), 'Anaphora antecedent recovered and kept with pronoun');

console.log(`\n========================================`);
console.log(`Test Results: \x1b[32m${passed} Passed\x1b[0m, \x1b[31m${failed} Failed\x1b[0m`);
console.log(`========================================\n`);

if (failed > 0) {
  process.exit(1);
} else {
  process.exit(0);
}
