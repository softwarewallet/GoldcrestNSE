import { brokerRegistry } from '../src/brokers/registry';
import { CTraderBrokerAdapter } from '../src/brokers/adapters/cTrader/CTraderBrokerAdapter';
import { updateSystemConfig } from '../src/services/configService';

async function runAccountSelectionRegressionTest() {
  console.log('================================================================');
  console.log('REGRESSION TEST: cTrader Authoritative Account Selection');
  console.log('REPRODUCING DEFECT: "Wrong Balance from Multiple Accounts"');
  console.log('================================================================\n');

  try {
    const adapter = brokerRegistry.getAdapter('CTRADER') as CTraderBrokerAdapter;
    
    if (!adapter) {
      throw new Error('cTrader adapter not found in registry');
    }

    // Step 1: Discover available accounts
    console.log('[STEP 1] Discovering available accounts...');
    const accounts = await adapter.getAccounts();
    console.log(`[INFO] Found ${accounts.length} accounts:`, accounts.map(a => a.accountId).join(', '));

    if (accounts.length < 2) {
      console.warn('[WARNING] Test requires at least 2 discovered accounts to fully verify selection logic.');
    }

    const accountA = accounts[0];
    const accountB = accounts[1] || { accountId: '9999999', balance: 0, currency: 'USD', equity: 0, server: 'MockServerB', accountType: 'LIVE' };

    // Step 2: Select Account B and verify balance
    console.log(`\n[STEP 2] Selecting Account B (${accountB.accountId})...`);
    updateSystemConfig({
      selectedCtraderAccountId: accountB.accountId
    });

    const activeAccountB = await adapter.getAccount();
    console.log(`[INFO] Active Account ID: ${activeAccountB.accountId}`);
    console.log(`[INFO] Active Balance: ${activeAccountB.currency} ${activeAccountB.balance}`);

    if (activeAccountB.accountId !== accountB.accountId) {
      throw new Error(`CRITICAL DEFECT: Selected Account ID ${accountB.accountId} but adapter returned ${activeAccountB.accountId}`);
    }
    
    // In our mock, account B has balance 100000 while A has 50000 (from previous logs)
    // Let's verify it matches the source account data
    if (activeAccountB.balance !== accountB.balance) {
      throw new Error(`CRITICAL DEFECT: Balance mismatch. Expected ${accountB.balance}, got ${activeAccountB.balance}`);
    }
    console.log('✅ Account B selection verified.');

    // Step 3: Switch back to Account A and verify balance
    console.log(`\n[STEP 3] Switching to Account A (${accountA.accountId})...`);
    updateSystemConfig({
      selectedCtraderAccountId: accountA.accountId
    });

    const activeAccountA = await adapter.getAccount();
    console.log(`[INFO] Active Account ID: ${activeAccountA.accountId}`);
    console.log(`[INFO] Active Balance: ${activeAccountA.currency} ${activeAccountA.balance}`);

    if (activeAccountA.accountId !== accountA.accountId) {
      throw new Error(`CRITICAL DEFECT: Selected Account ID ${accountA.accountId} but adapter returned ${activeAccountA.accountId}`);
    }
    
    if (activeAccountA.balance !== accountA.balance) {
      throw new Error(`CRITICAL DEFECT: Balance mismatch. Expected ${accountA.balance}, got ${activeAccountA.balance}`);
    }
    console.log('✅ Account A selection verified.');

    console.log('\n================================================================');
    console.log('FINAL STATUS: PASSED');
    console.log('VERIFICATION: Authoritative account selection is enforced.');
    console.log('================================================================');
    process.exit(0);

  } catch (err: any) {
    console.error('\n❌ REGRESSION TEST FAILED');
    console.error(`ERROR: ${err.message}`);
    process.exit(1);
  }
}

runAccountSelectionRegressionTest();
