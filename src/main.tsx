import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import { OperatorSessionGate } from './components/OperatorSessionGate';
import { RuntimeErrorBoundary } from './components/RuntimeErrorBoundary';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RuntimeErrorBoundary>
      <OperatorSessionGate><App /></OperatorSessionGate>
    </RuntimeErrorBoundary>
  </StrictMode>,
);
