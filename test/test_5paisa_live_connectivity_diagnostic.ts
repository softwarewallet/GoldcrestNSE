import { FivePaisaLiveAdapter } from '../src/brokers/adapters/fivepaisa/FivePaisaLiveAdapter';
import { updateSystemConfig } from '../src/services/configService';

async function run5PaisaConnectivityDiagnostic() {
  console.log('=== 5PAISA LIVE CONNECTIVITY DIAGNOSTIC ===');

  const adapter = new FivePaisaLiveAdapter();
  
  const diagnostic = {
    broker: 'FIVE_PAISA',
    environment: 'LIVE',
    authentication: 'FAIL',
    account_discovery: 'FAIL',
    margin_access: 'FAIL',
    positions_access: 'FAIL',
    orders_read_access: 'FAIL',
    market_data_access: 'FAIL',
    instrument_metadata: 'FAIL',
    overall_connectivity: 'FAIL'
  };

  try {
    // 1. Authentication
    const authSuccess = await adapter.ensureActiveSession();
    diagnostic.authentication = authSuccess ? 'PASS' : 'FAIL';

    if (authSuccess) {
      // 2. Account Discovery
      try {
        const account = await adapter.getAccount();
        diagnostic.account_discovery = account ? 'PASS' : 'FAIL';
      } catch (e) {
        diagnostic.account_discovery = 'FAIL';
      }

      // 3. Margin Access
      try {
        const margin = await adapter.fetchMarginFromApi();
        diagnostic.margin_access = margin ? 'PASS' : 'FAIL';
      } catch (e) {
        diagnostic.margin_access = 'FAIL';
      }

      // 4. Positions Access
      try {
        const positions = await adapter.getPositions();
        diagnostic.positions_access = Array.isArray(positions) ? 'PASS' : 'FAIL';
      } catch (e) {
        diagnostic.positions_access = 'FAIL';
      }

      // 5. Orders Read Access
      try {
        const orders = await adapter.getOpenOrders();
        diagnostic.orders_read_access = Array.isArray(orders) ? 'PASS' : 'FAIL';
      } catch (e) {
        diagnostic.orders_read_access = 'FAIL';
      }

      // 6. Market Data Access
      try {
        // Try to get quote for NIFTY
        const quote = await adapter.getQuote('NIFTY');
        diagnostic.market_data_access = quote ? 'PASS' : 'FAIL';
      } catch (e) {
        diagnostic.market_data_access = 'FAIL';
      }

      // 7. Instrument Metadata
      try {
        const instruments = await adapter.getInstruments();
        diagnostic.instrument_metadata = instruments.length > 0 ? 'PASS' : 'FAIL';
      } catch (e) {
        diagnostic.instrument_metadata = 'FAIL';
      }
    }

    diagnostic.overall_connectivity = (
      diagnostic.authentication === 'PASS' &&
      diagnostic.account_discovery === 'PASS' &&
      diagnostic.margin_access === 'PASS'
    ) ? 'PASS' : 'FAIL';

  } catch (err: any) {
    console.error('Diagnostic error:', err.message);
  }

  console.log(`broker: ${diagnostic.broker}`);
  console.log(`environment: ${diagnostic.environment}`);
  console.log(`authentication: ${diagnostic.authentication}`);
  console.log(`account_discovery: ${diagnostic.account_discovery}`);
  console.log(`margin_access: ${diagnostic.margin_access}`);
  console.log(`positions_access: ${diagnostic.positions_access}`);
  console.log(`orders_read_access: ${diagnostic.orders_read_access}`);
  console.log(`market_data_access: ${diagnostic.market_data_access}`);
  console.log(`instrument_metadata: ${diagnostic.instrument_metadata}`);
  console.log(`overall_connectivity: ${diagnostic.overall_connectivity}`);
}

run5PaisaConnectivityDiagnostic().catch(err => {
  console.error('Diagnostic failed:', err);
  process.exit(1);
});
