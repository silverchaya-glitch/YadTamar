// מריץ בדיקות זעיר, בלי תלות חיצונית (שומר על "בלי npm חדש" עבור צד הבדיקות).
// כל קובץ *.test.js קורא ל-createSuite(שם הקובץ), רץ test()/skip() עבור כל מקרה,
// ומסיים ב-finish() שמדפיס שורת סיכום וקובע exit code (1 אם יש כישלון).
// פורמט פלט קבוע: <file> | <test name> | PASS/FAIL/SKIP | <detail>

function createSuite(fileLabel) {
  const results = [];

  async function test(name, fn) {
    try {
      await fn();
      results.push({ name, status: 'PASS', detail: '' });
      console.log(`${fileLabel} | ${name} | PASS |`);
    } catch (err) {
      results.push({ name, status: 'FAIL', detail: err.message });
      console.log(`${fileLabel} | ${name} | FAIL | ${err.message}`);
    }
  }

  function skip(name, reason) {
    results.push({ name, status: 'SKIP', detail: reason });
    console.log(`${fileLabel} | ${name} | SKIP | ${reason}`);
  }

  function finish() {
    const passed = results.filter(r => r.status === 'PASS').length;
    const failed = results.filter(r => r.status === 'FAIL').length;
    const skipped = results.filter(r => r.status === 'SKIP').length;
    console.log(`${fileLabel} | SUMMARY | ${passed} passed, ${failed} failed, ${skipped} skipped`);
    process.exitCode = failed > 0 ? 1 : 0;
  }

  return { test, skip, finish };
}

module.exports = { createSuite };
