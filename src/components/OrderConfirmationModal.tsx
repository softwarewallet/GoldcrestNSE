import React from 'react';
import { ShieldCheck, ShieldAlert, X, ArrowUpRight, ArrowDownRight, AlertTriangle } from 'lucide-react';
import { BrokerType, TradingEnvironment, OrderRequest } from '../brokers/types';

interface OrderConfirmationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (order: OrderRequest) => void;
  order: OrderRequest;
  broker: BrokerType;
  environment: TradingEnvironment;
  maskedAccount: string;
  currentPrice: number;
  pipOrPointVal?: number;
}

export const OrderConfirmationModal: React.FC<OrderConfirmationModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
  order,
  broker,
  environment,
  maskedAccount,
  currentPrice,
  pipOrPointVal = 1
}) => {
  if (!isOpen) return null;

  const isLive = environment === 'LIVE';
  const entry = order.price || currentPrice;
  const sl = order.stopLoss;
  const tp = order.takeProfit;

  const riskDistance = sl ? Math.abs(entry - sl) : 0;
  const rewardDistance = tp ? Math.abs(tp - entry) : 0;
  const isBuy = order.side === 'BUY';

  // Estimate maximum loss
  const currency = broker === 'FIVE_PAISA' ? 'INR' : 'USD';
  const estimatedMaxLoss = sl ? (riskDistance * order.quantity * (broker === 'FIVE_PAISA' ? 1 : 10)).toFixed(2) : 'UNDEFINED';
  const estimatedCharges = broker === 'FIVE_PAISA' ? '₹20.00 Flat Brokerage' : '$2.00 Commission / lot';

  return (
    <div id="order_confirmation_modal_overlay" className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <div id="order_confirmation_card" className="bg-slate-900 border border-slate-700 rounded-xl max-w-md w-full p-5 space-y-4 shadow-2xl animate-in fade-in zoom-in-95 duration-150">
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div className="flex items-center space-x-2">
            {isLive ? (
              <ShieldAlert className="w-5 h-5 text-rose-500" />
            ) : (
              <ShieldCheck className="w-5 h-5 text-emerald-400" />
            )}
            <h3 className="text-base font-bold text-white">
              {isLive ? 'Confirm LIVE Order Execution' : 'Order Execution Confirmation'}
            </h3>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1 rounded hover:bg-slate-800 transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* High Visibility Environment Tag */}
        <div className="flex items-center justify-between bg-slate-950 p-2.5 rounded-lg border border-slate-800 text-xs font-mono">
          <div className="flex items-center space-x-2">
            <span className="text-slate-400">Environment:</span>
            <span className={`px-2 py-0.5 rounded font-bold ${
              isLive
                ? 'bg-rose-950 text-rose-400 border border-rose-700'
                : 'bg-emerald-950 text-emerald-400 border border-emerald-700'
            }`}>
              {environment} MODE
            </span>
          </div>
          <div>
            <span className="text-slate-400">Broker: </span>
            <span className="text-slate-200 font-bold">{broker}</span>
          </div>
        </div>

        {isLive && (
          <div className="bg-rose-950/60 border border-rose-800 p-2.5 rounded-lg text-xs text-rose-200 flex items-start space-x-2">
            <AlertTriangle className="w-4 h-4 text-rose-400 flex-shrink-0 mt-0.5" />
            <span>
              Real-capital transaction. This order will be routed to the live exchange via <strong>{broker}</strong> (Account: {maskedAccount}).
            </span>
          </div>
        )}

        {/* Order Details Grid */}
        <div className="bg-slate-950 rounded-lg border border-slate-800 p-3 space-y-2 text-xs font-mono">
          <div className="flex justify-between py-1 border-b border-slate-800/80">
            <span className="text-slate-400">Account:</span>
            <span className="text-slate-200 font-bold">{maskedAccount}</span>
          </div>
          <div className="flex justify-between py-1 border-b border-slate-800/80">
            <span className="text-slate-400">Symbol / Pair:</span>
            <span className="text-slate-100 font-bold text-sm">{order.symbol}</span>
          </div>
          <div className="flex justify-between py-1 border-b border-slate-800/80">
            <span className="text-slate-400">Side & Type:</span>
            <div className="flex items-center space-x-1.5 font-bold">
              <span className={`flex items-center ${isBuy ? 'text-emerald-400' : 'text-rose-400'}`}>
                {isBuy ? <ArrowUpRight className="w-3.5 h-3.5 mr-0.5" /> : <ArrowDownRight className="w-3.5 h-3.5 mr-0.5" />}
                {order.side}
              </span>
              <span className="text-slate-400">({order.orderType})</span>
            </div>
          </div>
          <div className="flex justify-between py-1 border-b border-slate-800/80">
            <span className="text-slate-400">Quantity / Lots:</span>
            <span className="text-slate-200 font-bold">{order.quantity.toLocaleString()}</span>
          </div>
          <div className="flex justify-between py-1 border-b border-slate-800/80">
            <span className="text-slate-400">Est. Entry Price:</span>
            <span className="text-slate-200 font-bold">{entry}</span>
          </div>
          <div className="flex justify-between py-1 border-b border-slate-800/80">
            <span className="text-slate-400">Stop Loss:</span>
            <span className="text-rose-400 font-bold">{sl ? sl : 'NOT SET'}</span>
          </div>
          <div className="flex justify-between py-1 border-b border-slate-800/80">
            <span className="text-slate-400">Take Profit:</span>
            <span className="text-emerald-400 font-bold">{tp ? tp : 'NOT SET'}</span>
          </div>
          <div className="flex justify-between py-1 border-b border-slate-800/80">
            <span className="text-slate-400">Estimated Max Loss:</span>
            <span className="text-rose-400 font-bold">{currency} {estimatedMaxLoss}</span>
          </div>
          <div className="flex justify-between py-1 border-b border-slate-800/80">
            <span className="text-slate-400">Estimated Charges:</span>
            <span className="text-slate-300">{estimatedCharges}</span>
          </div>
          <div className="flex justify-between py-1">
            <span className="text-slate-400">Signal ID / Strategy:</span>
            <span className="text-slate-400 truncate max-w-[180px]">{order.signalId || 'MANUAL_ASSISTED'}</span>
          </div>
        </div>

        <div className="flex items-center justify-end space-x-3 pt-2">
          <button
            onClick={onClose}
            className="px-4 py-2 text-xs font-medium rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition"
          >
            Cancel
          </button>
          <button
            id="btn_confirm_submit_order"
            onClick={() => onConfirm(order)}
            className={`px-4 py-2 text-xs font-bold rounded-lg transition flex items-center space-x-1.5 ${
              isLive
                ? 'bg-rose-600 hover:bg-rose-500 text-white shadow-lg shadow-rose-950'
                : 'bg-emerald-600 hover:bg-emerald-500 text-white'
            }`}
          >
            <span>Confirm & Dispatch Order</span>
          </button>
        </div>
      </div>
    </div>
  );
};
