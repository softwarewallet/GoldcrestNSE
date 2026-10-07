import fs from 'node:fs';
import path from 'node:path';

export interface ProductionReleaseIntegrityInput {
  environment: string;
  nodeVersion: string;
  tradingMode: string;
  operatorAuthConfigured: boolean;
  liveBrokerConfigured: boolean;
  distServerFile?: string;
  distIndexFile?: string;
  dataDirectory?: string;
  packageVersion?: string;
}

export interface ProductionReleaseIntegrityResult {
  ok: boolean;
  checks: Record<string, 'PASS' | 'FAIL'>;
  failures: string[];
  version: string;
}

export function getInstalledApplicationVersion(rootDirectory = process.cwd()): string {
  try {
    const packageFile = path.join(rootDirectory, 'package.json');
    const parsed = JSON.parse(fs.readFileSync(packageFile, 'utf8'));
    return typeof parsed.version === 'string' ? parsed.version.trim() : '';
  } catch {
    return '';
  }
}

function isSupportedNodeVersion(version: string): boolean {
  const match = String(version).trim().replace(/^v/, '').match(/^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/);
  if (!match) return false;

  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3]);

  if (major !== 24) return false;
  return minor > 21 || (minor === 21 && patch >= 0);
}

function fileExists(file: string): boolean {
  try { return fs.statSync(file).isFile(); } catch { return false; }
}

function directoryWritable(directory: string): boolean {
  try {
    fs.mkdirSync(directory, { recursive: true });
    fs.accessSync(directory, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

export function evaluateProductionReleaseIntegrity(input: ProductionReleaseIntegrityInput): ProductionReleaseIntegrityResult {
  const checks: Record<string, 'PASS' | 'FAIL'> = {};
  const failures: string[] = [];
  const version = String(input.packageVersion || '').trim();

  const check = (name: string, ok: boolean): void => {
    checks[name] = ok ? 'PASS' : 'FAIL';
    if (!ok) failures.push(name);
  };

  check('environment', input.environment === 'production');
  check('nodeVersion', isSupportedNodeVersion(input.nodeVersion));
  check('tradingMode', input.tradingMode === 'LIVE_ONLY');
  check('operatorAuth', input.operatorAuthConfigured);
  check('liveBroker', input.liveBrokerConfigured);
  check('packageVersion', Boolean(version));
  check('distServer', Boolean(input.distServerFile) && fileExists(String(input.distServerFile)));
  check('distIndex', Boolean(input.distIndexFile) && fileExists(String(input.distIndexFile)));
  check('dataDirectoryWritable', Boolean(input.dataDirectory) && directoryWritable(String(input.dataDirectory)));

  return { ok: failures.length === 0, checks, failures, version };
}

export function buildProductionReleaseIntegrityInput(options: {
  environment?: string;
  nodeVersion?: string;
  tradingMode: string;
  operatorAuthConfigured: boolean;
  liveBrokerConfigured: boolean;
  packageVersion?: string;
  rootDirectory?: string;
}): ProductionReleaseIntegrityInput {
  const root = options.rootDirectory || process.cwd();
  return {
    environment: options.environment || process.env.NODE_ENV || 'development',
    nodeVersion: options.nodeVersion || process.versions.node,
    tradingMode: options.tradingMode,
    operatorAuthConfigured: options.operatorAuthConfigured,
    liveBrokerConfigured: options.liveBrokerConfigured,
    distServerFile: path.join(root, 'dist', 'server.cjs'),
    distIndexFile: path.join(root, 'dist', 'index.html'),
    dataDirectory: path.join(root, 'data'),
    packageVersion: options.packageVersion || process.env.GOLDCREST_RELEASE_VERSION || getInstalledApplicationVersion(root)
  };
}