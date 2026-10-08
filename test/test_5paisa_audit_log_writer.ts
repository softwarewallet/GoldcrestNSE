import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function testAuditLogWriter() {
  // 1. Initial Diagnostic & Runtime Directory Details
  console.log('EXECUTION RUNTIME DETAILS:');
  console.log(`process.cwd():                 ${process.cwd()}`);
  console.log(`process.argv:                  ${JSON.stringify(process.argv)}`);
  console.log(`__dirname:                     ${__dirname}`);
  console.log(`path.resolve("."):             ${path.resolve('.')}`);
  console.log(`process.env.GOLDCREST_DB_FILE: ${process.env.GOLDCREST_DB_FILE || 'NOT SET'}`);
  console.log('');

  // 2. Reliable Project Root Determination
  const projectRoot = path.resolve(process.cwd());
  const auditLogDirectory = path.resolve(projectRoot, 'data', 'logs');
  const testFilePath = path.resolve(auditLogDirectory, '5paisa_audit_writer_test.txt');
  const jsonLogPath = path.resolve(auditLogDirectory, '5paisa_live_connectivity_audit.json');
  const txtLogPath = path.resolve(auditLogDirectory, '5paisa_live_connectivity_audit.txt');

  console.log(`PROJECT_ROOT:        ${projectRoot}`);
  console.log(`AUDIT_LOG_DIRECTORY: ${auditLogDirectory}`);
  console.log(`TEST_FILE_PATH:      ${testFilePath}`);
  console.log(`JSON_LOG_PATH:       ${jsonLogPath}`);
  console.log(`TXT_LOG_PATH:        ${txtLogPath}`);
  console.log('');

  // 3. Create Directory
  if (!fs.existsSync(auditLogDirectory)) {
    fs.mkdirSync(auditLogDirectory, { recursive: true });
  }

  const dirExists = fs.existsSync(auditLogDirectory);
  console.log(`AUDIT DIRECTORY EXISTS: ${dirExists ? 'YES' : 'NO'}`);
  if (!dirExists) {
    throw new Error(`CRITICAL: Audit directory does not exist after creation: ${auditLogDirectory}`);
  }

  // 4. Write Physical Test File FIRST
  const testFileExpectedContent = 'GOLDCREST 5PAISA AUDIT WRITER TEST\nFILE CREATION VERIFIED';
  fs.writeFileSync(testFilePath, testFileExpectedContent, 'utf8');

  // Verify test file immediately
  const testFileExists = fs.existsSync(testFilePath);
  if (!testFileExists) {
    throw new Error(`CRITICAL: Test file not found on disk: ${testFilePath}`);
  }
  const testFileStats = fs.statSync(testFilePath);
  const testFileReadback = fs.readFileSync(testFilePath, 'utf8');
  const testReadbackPass = testFileReadback === testFileExpectedContent;

  console.log(`TEST FILE EXISTS:   ${testFileExists ? 'YES' : 'NO'}`);
  console.log(`TEST FILE SIZE:     ${testFileStats.size} bytes`);
  console.log(`TEST FILE READBACK: ${testReadbackPass ? 'PASS' : 'FAIL'}`);

  if (!testReadbackPass) {
    throw new Error('CRITICAL: Test file content does not match expected output.');
  }

  // 5. Write Minimal JSON Audit File
  const jsonReport = {
    test: '5paisa_live_connectivity_audit',
    fileCreationTest: true,
    timestamp: new Date().toISOString()
  };

  fs.writeFileSync(jsonLogPath, JSON.stringify(jsonReport, null, 2), 'utf8');

  // Verify JSON file immediately
  const jsonExists = fs.existsSync(jsonLogPath);
  if (!jsonExists) {
    throw new Error(`CRITICAL: JSON file not found on disk: ${jsonLogPath}`);
  }
  const jsonStats = fs.statSync(jsonLogPath);
  const jsonParsed = JSON.parse(fs.readFileSync(jsonLogPath, 'utf8'));
  const jsonReadbackPass = jsonParsed.test === '5paisa_live_connectivity_audit' && jsonParsed.fileCreationTest === true;

  console.log(`JSON FILE EXISTS:   ${jsonExists ? 'YES' : 'NO'}`);
  console.log(`JSON FILE SIZE:     ${jsonStats.size} bytes`);
  console.log(`JSON READBACK:      ${jsonReadbackPass ? 'PASS' : 'FAIL'}`);

  if (!jsonReadbackPass) {
    throw new Error('CRITICAL: JSON file readback verification failed.');
  }

  // 6. Write TXT Audit File
  const txtContent = `5PAISA LIVE CONNECTIVITY AUDIT\nFILE CREATION TEST: PASS\nTIMESTAMP: ${new Date().toISOString()}\n`;
  fs.writeFileSync(txtLogPath, txtContent, 'utf8');

  // Verify TXT file immediately
  const txtExists = fs.existsSync(txtLogPath);
  if (!txtExists) {
    throw new Error(`CRITICAL: TXT file not found on disk: ${txtLogPath}`);
  }
  const txtStats = fs.statSync(txtLogPath);
  const txtReadback = fs.readFileSync(txtLogPath, 'utf8');
  const txtReadbackPass = txtReadback === txtContent;

  console.log(`TXT FILE EXISTS:    ${txtExists ? 'YES' : 'NO'}`);
  console.log(`TXT FILE SIZE:      ${txtStats.size} bytes`);
  console.log(`TXT READBACK:       ${txtReadbackPass ? 'PASS' : 'FAIL'}`);

  if (!txtReadbackPass) {
    throw new Error('CRITICAL: TXT file readback verification failed.');
  }

  // 7. Node Level Final Physical Verification
  if (!fs.existsSync(testFilePath) || !fs.existsSync(jsonLogPath) || !fs.existsSync(txtLogPath)) {
    throw new Error('CRITICAL: One or more audit files failed final existence verification.');
  }

  // 8. Formatted Final Output
  console.log('');
  console.log('============================================================');
  console.log('AUDIT FILE CREATION TEST');
  console.log('============================================================');
  console.log('');
  console.log('PROJECT ROOT:');
  console.log(projectRoot);
  console.log('');
  console.log('AUDIT DIRECTORY:');
  console.log(auditLogDirectory);
  console.log('');
  console.log('TEST FILE:');
  console.log(testFilePath);
  console.log('');
  console.log('JSON FILE:');
  console.log(jsonLogPath);
  console.log('');
  console.log('TXT FILE:');
  console.log(txtLogPath);
  console.log('');
  console.log(`TEST FILE EXISTS: ${testFileExists ? 'YES' : 'NO'}`);
  console.log(`JSON FILE EXISTS: ${jsonExists ? 'YES' : 'NO'}`);
  console.log(`TXT FILE EXISTS:  ${txtExists ? 'YES' : 'NO'}`);
  console.log('');
  console.log(`TEST FILE SIZE: ${testFileStats.size} bytes`);
  console.log(`JSON FILE SIZE: ${jsonStats.size} bytes`);
  console.log(`TXT FILE SIZE:  ${txtStats.size} bytes`);
  console.log('');
  console.log(`JSON READBACK: ${jsonReadbackPass ? 'PASS' : 'FAIL'}`);
  console.log(`TXT READBACK:  ${txtReadbackPass ? 'PASS' : 'FAIL'}`);
  console.log('');
  console.log('EXECUTION ENVIRONMENT:');
  if (process.env.HOSTNAME || process.env.K_REVISION || process.cwd() === '/app/applet') {
    console.log('SANDBOX / CONTAINER (AI Studio Environment: /app/applet)');
  } else {
    console.log('LOCAL PROJECT');
  }
  console.log('');
  console.log('============================================================');
  console.log('FILE CREATION CERTIFICATION: PASS');
  console.log('============================================================');
}

testAuditLogWriter().catch(err => {
  console.error('\n❌ FILE CREATION TEST FAILED:', err);
  process.exit(1);
});
