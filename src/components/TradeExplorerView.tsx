import React, { useState, useEffect } from 'react';
import { Search, GitCommit, CheckCircle2, ArrowRight, ShieldCheck, Database, Server, Clock, AlertTriangle } from 'lucide-react';

export interface LineageNode {
  nodeId: string;
  nodeType: string;
  timestamp: number;
  payload: Record<string, any>;
}

export const TradeExplorerView: React.FC = () => {
  const [searchTraceId, setSearchTraceId] = useState<string>('trace_sample_101');
  const [activeTraceId, setActiveTraceId] = useState<string>('trace_sample_101');
  const [lineageNodes, setLineageNodes] = useState<LineageNode[]>([]);
  const [rootInfo, setRootInfo] = useState<any>(null);
  const [selectedNode, setSelectedNode] = useState<LineageNode | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);

  const fetchTradeLineage = async (traceId: string) => {
    setIsLoading(true);
    try {
      const res = await fetch(`/api/governance/trade-lineage/${encodeURIComponent(traceId)}`);
      if (res.ok) {
        const data = await res.json();
        setLineageNodes(data.nodes || []);
        setRootInfo(data.root || null);
        if (data.nodes && data.nodes.length > 0) {
          setSelectedNode(data.nodes[0]);
        }
      }
    } catch (err) {
      console.error('Failed to load trade lineage:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchTradeLineage(activeTraceId);
  }, [activeTraceId]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchTraceId.trim()) return;
    setActiveTraceId(searchTraceId.trim());
  };

  const getNodeColor = (type: string) => {
    switch (type) {
      case 'MARKET_SNAPSHOT': return 'border-blue-500 bg-blue-950/60 text-blue-300';
      case 'FEATURE_SNAPSHOT': return 'border-cyan-500 bg-cyan-950/60 text-cyan-300';
      case 'PREDICTION': return 'border-purple-500 bg-purple-950/60 text-purple-300';
      case 'SIGNAL': return 'border-indigo-500 bg-indigo-950/60 text-indigo-300';
      case 'RISK_DECISION': return 'border-amber-500 bg-amber-950/60 text-amber-300';
      case 'TRADE_PROPOSAL': return 'border-yellow-500 bg-yellow-950/60 text-yellow-300';
      case 'BROKER_ORDER': return 'border-emerald-500 bg-emerald-950/60 text-emerald-300';
      case 'FILL': return 'border-teal-500 bg-teal-950/60 text-teal-300';
      case 'POSITION': return 'border-blue-600 bg-blue-900/60 text-blue-200';
      case 'EXIT': return 'border-rose-500 bg-rose-950/60 text-rose-300';
      case 'TRADE_RESULT': return 'border-emerald-400 bg-emerald-900/60 text-emerald-200';
      case 'RECONCILIATION': return 'border-teal-400 bg-teal-900/60 text-teal-200';
      default: return 'border-slate-700 bg-slate-900 text-slate-300';
    }
  };

  return (
    <div id="trade_explorer_view" className="space-y-4 font-mono text-xs">
      {/* Search Header */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow">
        <form onSubmit={handleSearch} className="flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="space-y-1">
            <h3 className="text-sm font-bold text-white flex items-center space-x-2">
              <GitCommit className="w-4 h-4 text-emerald-400" />
              <span>Trade Lineage Explorer (Trace ID Lookup)</span>
            </h3>
            <p className="text-slate-400 text-[11px]">
              Complete end-to-end execution lineage graph from Market Data to 3-Way Reconciliation.
            </p>
          </div>

          <div className="flex items-center space-x-2 w-full sm:w-auto">
            <div className="relative flex-1 sm:w-64">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-slate-500" />
              <input
                type="text"
                value={searchTraceId}
                onChange={(e) => setSearchTraceId(e.target.value)}
                placeholder="Enter Trace ID..."
                className="w-full bg-slate-950 border border-slate-700 text-white pl-8 pr-3 py-1.5 rounded text-xs focus:outline-none focus:border-emerald-500"
              />
            </div>
            <button
              type="submit"
              disabled={isLoading}
              className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded shadow transition"
            >
              {isLoading ? 'FETCHING...' : 'SEARCH'}
            </button>
          </div>
        </form>
      </div>

      {/* DAG Lineage Graph & Detail Drawer */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Graph Columns */}
        <div className="lg:col-span-2 bg-slate-900 border border-slate-800 rounded-xl p-4 shadow space-y-3">
          <div className="flex items-center justify-between border-b border-slate-800 pb-2">
            <span className="text-xs font-bold text-slate-200">
              EXECUTION DAG GRAPH: <strong className="text-amber-300">{activeTraceId}</strong>
            </span>
            <span className="text-[10px] text-emerald-400 font-bold bg-emerald-950 border border-emerald-800 px-2 py-0.5 rounded">
              12 NODES CHAINED
            </span>
          </div>

          <div className="space-y-2 max-h-[500px] overflow-y-auto pr-1">
            {lineageNodes.map((node, i) => {
              const isSelected = selectedNode?.nodeId === node.nodeId;
              const nodeClass = getNodeColor(node.nodeType);

              return (
                <div key={node.nodeId} className="flex items-center space-x-2">
                  <span className="w-6 text-slate-500 text-[10px] text-right font-bold">#{i + 1}</span>
                  <div
                    onClick={() => setSelectedNode(node)}
                    className={`flex-1 p-2.5 rounded-lg border cursor-pointer transition ${nodeClass} ${
                      isSelected ? 'ring-2 ring-emerald-400 shadow-md scale-[1.01]' : 'hover:border-slate-500'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-bold">{node.nodeType}</span>
                      <span className="text-[10px] opacity-80">{new Date(node.timestamp).toLocaleTimeString()}</span>
                    </div>
                    <div className="text-[10px] opacity-75 mt-0.5 truncate">
                      Node ID: {node.nodeId} | {JSON.stringify(node.payload).substring(0, 60)}...
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Node Payload Detail View */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow space-y-3">
          <div className="border-b border-slate-800 pb-2">
            <h4 className="text-xs font-bold text-white flex items-center space-x-1.5">
              <Database className="w-3.5 h-3.5 text-cyan-400" />
              <span>Node Payload Inspector</span>
            </h4>
          </div>

          {selectedNode ? (
            <div className="space-y-3">
              <div className="bg-slate-950 p-2.5 rounded border border-slate-800 space-y-1">
                <div className="flex justify-between text-slate-400 text-[10px]">
                  <span>NODE TYPE:</span>
                  <strong className="text-emerald-400">{selectedNode.nodeType}</strong>
                </div>
                <div className="flex justify-between text-slate-400 text-[10px]">
                  <span>NODE ID:</span>
                  <span className="text-slate-200">{selectedNode.nodeId}</span>
                </div>
                <div className="flex justify-between text-slate-400 text-[10px]">
                  <span>TIMESTAMP:</span>
                  <span className="text-slate-200">{new Date(selectedNode.timestamp).toLocaleString()}</span>
                </div>
              </div>

              <div className="bg-slate-950 p-3 rounded border border-slate-800 space-y-1">
                <span className="text-[10px] text-slate-400 uppercase font-bold">Raw Payload JSON:</span>
                <pre className="text-[11px] text-emerald-300 font-mono bg-slate-900 p-2 rounded max-h-64 overflow-y-auto overflow-x-auto whitespace-pre-wrap">
                  {JSON.stringify(selectedNode.payload, null, 2)}
                </pre>
              </div>
            </div>
          ) : (
            <div className="p-8 text-center text-slate-500 text-xs">
              Select a node in the DAG graph to inspect its raw payload.
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
