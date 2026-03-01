'use client';

import { useState } from 'react';

const CHAINS = [
  { name: 'Fast', value: 'fast', token: 'SET', placeholder: 'set1...' },
  { name: 'Base', value: 'base', token: 'ETH', placeholder: '0x...' },
  { name: 'Ethereum', value: 'ethereum', token: 'ETH', placeholder: '0x...' },
  { name: 'Arbitrum', value: 'arbitrum', token: 'ETH', placeholder: '0x...' },
  { name: 'Polygon', value: 'polygon', token: 'POL', placeholder: '0x...' },
  { name: 'Optimism', value: 'optimism', token: 'ETH', placeholder: '0x...' },
  { name: 'BSC', value: 'bsc', token: 'BNB', placeholder: '0x...' },
  { name: 'Avalanche', value: 'avalanche', token: 'AVAX', placeholder: '0x...' },
  { name: 'Fantom', value: 'fantom', token: 'FTM', placeholder: '0x...' },
  { name: 'zkSync', value: 'zksync', token: 'ETH', placeholder: '0x...' },
  { name: 'Linea', value: 'linea', token: 'ETH', placeholder: '0x...' },
  { name: 'Scroll', value: 'scroll', token: 'ETH', placeholder: '0x...' },
  { name: 'Solana', value: 'solana', token: 'SOL', placeholder: 'base58 address...' },
];

const ADDRESS_PATTERNS: Record<string, RegExp> = {
  fast: /^set1[a-z0-9]{38,}$/,
  base: /^0x[0-9a-fA-F]{40}$/,
  ethereum: /^0x[0-9a-fA-F]{40}$/,
  arbitrum: /^0x[0-9a-fA-F]{40}$/,
  polygon: /^0x[0-9a-fA-F]{40}$/,
  optimism: /^0x[0-9a-fA-F]{40}$/,
  bsc: /^0x[0-9a-fA-F]{40}$/,
  avalanche: /^0x[0-9a-fA-F]{40}$/,
  fantom: /^0x[0-9a-fA-F]{40}$/,
  zksync: /^0x[0-9a-fA-F]{40}$/,
  linea: /^0x[0-9a-fA-F]{40}$/,
  scroll: /^0x[0-9a-fA-F]{40}$/,
  solana: /^[1-9A-HJ-NP-Za-km-z]{32,44}$/,
};

function isValidAddress(address: string, chain: string): boolean {
  const pattern = ADDRESS_PATTERNS[chain];
  if (!pattern) return false;
  return pattern.test(address);
}

export default function PayPage() {
  const [chain, setChain] = useState('fast');
  const [receiver, setReceiver] = useState('');
  const [amount, setAmount] = useState('');
  const [token, setToken] = useState('SET');
  const [network, setNetwork] = useState('testnet');
  const [memo, setMemo] = useState('');
  const [error, setError] = useState('');
  const [resultUrl, setResultUrl] = useState('');
  const [copied, setCopied] = useState(false);

  const selectedChain = CHAINS.find((c) => c.value === chain) ?? CHAINS[0];

  function handleChainChange(newChain: string) {
    setChain(newChain);
    const found = CHAINS.find((c) => c.value === newChain);
    if (found) {
      setToken(found.token);
    }
    setError('');
    setResultUrl('');
  }

  function handleGenerate() {
    setError('');
    setResultUrl('');

    if (!chain) {
      setError('Please select a chain.');
      return;
    }

    if (!receiver.trim()) {
      setError('Receiver address is required.');
      return;
    }

    if (!isValidAddress(receiver.trim(), chain)) {
      setError('Invalid receiver address for the selected chain.');
      return;
    }

    const parsedAmount = parseFloat(amount);
    if (!amount || isNaN(parsedAmount) || parsedAmount <= 0) {
      setError('Amount must be a positive number.');
      return;
    }

    const params = new URLSearchParams({
      receiver: receiver.trim(),
      amount: amount.trim(),
      chain,
      token: token.trim() || selectedChain.token,
      network,
    });

    if (memo.trim()) {
      params.set('memo', memo.trim());
    }

    const url = window.location.origin + '/api/pay?' + params.toString();
    setResultUrl(url);
  }

  function handleCopy() {
    if (!resultUrl) return;
    navigator.clipboard.writeText(resultUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <>
      <style>{`
        .pay-page {
          min-height: 100vh;
          display: flex;
          flex-direction: column;
        }

        .pay-main {
          flex: 1;
          padding: 7rem 0 5rem;
        }

        .pay-header {
          margin-bottom: 2.5rem;
        }

        .pay-label {
          font-size: 0.62rem;
          font-weight: 600;
          letter-spacing: 0.2em;
          text-transform: uppercase;
          color: var(--text-3);
          margin-bottom: 0.75rem;
        }

        .pay-title {
          font-family: var(--font-display), serif;
          font-size: clamp(2rem, 6vw, 3rem);
          font-weight: 400;
          font-style: italic;
          letter-spacing: -0.03em;
          line-height: 1.1;
          color: var(--text);
          margin-bottom: 0.6rem;
        }

        .pay-subtitle {
          font-size: 0.95rem;
          color: var(--text-2);
          line-height: 1.6;
        }

        .pay-card {
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: 10px;
          padding: 2rem;
        }

        .form-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 1.25rem;
        }

        .form-field {
          display: flex;
          flex-direction: column;
          gap: 0.4rem;
        }

        .form-field.full-width {
          grid-column: 1 / -1;
        }

        .form-label {
          font-size: 0.72rem;
          font-weight: 600;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          color: var(--text-3);
        }

        .form-label span {
          font-weight: 400;
          text-transform: none;
          letter-spacing: 0;
          color: var(--text-3);
          margin-left: 0.3rem;
        }

        .form-input,
        .form-select {
          background: var(--code-bg);
          border: 1px solid var(--border);
          border-radius: 5px;
          padding: 0.6rem 0.85rem;
          font-size: 0.85rem;
          color: var(--text);
          font-family: var(--font-body), system-ui, sans-serif;
          width: 100%;
          transition: border-color 0.2s;
          outline: none;
          appearance: none;
          -webkit-appearance: none;
        }

        .form-input::placeholder {
          color: var(--text-3);
        }

        .form-input:focus,
        .form-select:focus {
          border-color: var(--text-3);
        }

        .form-select {
          cursor: pointer;
          background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8'%3E%3Cpath d='M1 1l5 5 5-5' stroke='%23525250' stroke-width='1.5' fill='none' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
          background-repeat: no-repeat;
          background-position: right 0.85rem center;
          padding-right: 2.25rem;
        }

        .form-actions {
          margin-top: 1.75rem;
        }

        .generate-btn {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          padding: 0.65rem 1.75rem;
          background: var(--text);
          color: var(--bg);
          font-size: 0.82rem;
          font-weight: 600;
          letter-spacing: 0.02em;
          border-radius: 4px;
          border: none;
          cursor: pointer;
          transition: opacity 0.2s;
          font-family: var(--font-body), system-ui, sans-serif;
        }

        .generate-btn:hover {
          opacity: 0.85;
        }

        .form-error {
          margin-top: 1rem;
          font-size: 0.82rem;
          color: #ef4444;
        }

        .result-section {
          margin-top: 2rem;
          padding-top: 2rem;
          border-top: 1px solid var(--border);
        }

        .result-label {
          font-size: 0.62rem;
          font-weight: 600;
          letter-spacing: 0.2em;
          text-transform: uppercase;
          color: var(--text-3);
          margin-bottom: 0.75rem;
        }

        .result-url-wrap {
          display: flex;
          align-items: center;
          gap: 0.75rem;
          background: var(--code-bg);
          border: 1px solid var(--border);
          border-radius: 6px;
          padding: 0.85rem 1rem;
        }

        .result-url {
          font-family: var(--font-mono), monospace;
          font-size: 0.75rem;
          color: var(--rule);
          word-break: break-all;
          flex: 1;
          line-height: 1.5;
        }

        .result-copy-btn {
          padding: 0.35rem 0.8rem;
          font-size: 0.72rem;
          font-family: var(--font-mono), monospace;
          letter-spacing: 0.04em;
          color: var(--text-3);
          background: transparent;
          border: 1px solid var(--border);
          border-radius: 4px;
          cursor: pointer;
          transition: color 0.2s, border-color 0.2s;
          flex-shrink: 0;
        }

        .result-copy-btn:hover {
          color: var(--text);
          border-color: var(--text-3);
        }

        .result-hint {
          margin-top: 0.75rem;
          font-size: 0.8rem;
          color: var(--text-3);
          line-height: 1.5;
        }

        @media (max-width: 600px) {
          .pay-main {
            padding: 6rem 0 4rem;
          }

          .pay-card {
            padding: 1.5rem 1.25rem;
          }

          .form-grid {
            grid-template-columns: 1fr;
          }

          .form-field.full-width {
            grid-column: 1;
          }

          .result-url-wrap {
            flex-direction: column;
            align-items: flex-start;
          }

          .result-copy-btn {
            align-self: flex-end;
          }
        }
      `}</style>

      <div className="pay-page">
        <nav className="nav">
          <div className="nav-inner">
            <a href="/" className="nav-wordmark">money</a>
            <div className="nav-links">
              <a href="/pay">Pay</a>
              <a href="/skill.md">Skill</a>
              <a href="/money.bundle.js" download>Bundle</a>
            </div>
          </div>
        </nav>

        <main className="pay-main">
          <div className="container">
            <div className="pay-header">
              <p className="pay-label">Universal Payment Links</p>
              <h1 className="pay-title">Payment Link</h1>
              <p className="pay-subtitle">Create a shareable payment link for any chain</p>
            </div>

            <div className="pay-card">
              <div className="form-grid">
                <div className="form-field">
                  <label className="form-label" htmlFor="chain">Chain</label>
                  <select
                    id="chain"
                    className="form-select"
                    value={chain}
                    onChange={(e) => handleChainChange(e.target.value)}
                  >
                    {CHAINS.map((c) => (
                      <option key={c.value} value={c.value}>
                        {c.name} ({c.token})
                      </option>
                    ))}
                  </select>
                </div>

                <div className="form-field">
                  <label className="form-label" htmlFor="network">Network</label>
                  <select
                    id="network"
                    className="form-select"
                    value={network}
                    onChange={(e) => setNetwork(e.target.value)}
                  >
                    <option value="testnet">Testnet</option>
                    <option value="mainnet">Mainnet</option>
                  </select>
                </div>

                <div className="form-field full-width">
                  <label className="form-label" htmlFor="receiver">Receiver Address</label>
                  <input
                    id="receiver"
                    type="text"
                    className="form-input"
                    placeholder={selectedChain.placeholder}
                    value={receiver}
                    onChange={(e) => {
                      setReceiver(e.target.value);
                      setError('');
                      setResultUrl('');
                    }}
                    spellCheck={false}
                    autoComplete="off"
                  />
                </div>

                <div className="form-field">
                  <label className="form-label" htmlFor="amount">Amount</label>
                  <input
                    id="amount"
                    type="number"
                    className="form-input"
                    placeholder="0.00"
                    step="any"
                    min="0"
                    value={amount}
                    onChange={(e) => {
                      setAmount(e.target.value);
                      setError('');
                      setResultUrl('');
                    }}
                  />
                </div>

                <div className="form-field">
                  <label className="form-label" htmlFor="token">
                    Token
                    <span>(optional — defaults to native)</span>
                  </label>
                  <input
                    id="token"
                    type="text"
                    className="form-input"
                    placeholder={selectedChain.token}
                    value={token}
                    onChange={(e) => setToken(e.target.value)}
                    spellCheck={false}
                    autoComplete="off"
                  />
                </div>

                <div className="form-field full-width">
                  <label className="form-label" htmlFor="memo">
                    Memo
                    <span>(optional)</span>
                  </label>
                  <input
                    id="memo"
                    type="text"
                    className="form-input"
                    placeholder="e.g. invoice 42"
                    value={memo}
                    onChange={(e) => setMemo(e.target.value)}
                  />
                </div>
              </div>

              <div className="form-actions">
                <button className="generate-btn" onClick={handleGenerate}>
                  Generate Link
                </button>
              </div>

              {error && (
                <p className="form-error">{error}</p>
              )}

              {resultUrl && (
                <div className="result-section">
                  <p className="result-label">Payment Link</p>
                  <div className="result-url-wrap">
                    <span className="result-url">{resultUrl}</span>
                    <button className="result-copy-btn" onClick={handleCopy}>
                      {copied ? 'copied' : 'copy'}
                    </button>
                  </div>
                  <p className="result-hint">
                    Share this URL with an AI agent to generate a payment request.
                  </p>
                </div>
              )}
            </div>
          </div>
        </main>

        <footer className="footer">
          <div className="container footer-inner">
            <span className="footer-credit">Fast Protocol</span>
            <nav className="footer-nav">
              <a href="/pay">Pay</a>
              <a href="/skill.md">Skill</a>
              <a href="/money.bundle.js" download>Bundle</a>
            </nav>
          </div>
        </footer>
      </div>
    </>
  );
}
