import { headers } from 'next/headers';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CopyButton } from './copy-button';

const chains = [
  { name: 'Fast', token: 'SET', format: 'set1...' },
  { name: 'Base', token: 'ETH', format: '0x...' },
  { name: 'Ethereum', token: 'ETH', format: '0x...' },
  { name: 'Arbitrum', token: 'ETH', format: '0x...' },
  { name: 'Polygon', token: 'POL', format: '0x...' },
  { name: 'Optimism', token: 'ETH', format: '0x...' },
  { name: 'BSC', token: 'BNB', format: '0x...' },
  { name: 'Avalanche', token: 'AVAX', format: '0x...' },
  { name: 'Fantom', token: 'FTM', format: '0x...' },
  { name: 'zkSync', token: 'ETH', format: '0x...' },
  { name: 'Linea', token: 'ETH', format: '0x...' },
  { name: 'Scroll', token: 'ETH', format: '0x...' },
  { name: 'Solana', token: 'SOL', format: 'base58' },
];

export default async function Home() {
  const headersList = await headers();
  const host = headersList.get('host') || 'localhost:3000';
  const protocol = host.startsWith('localhost') ? 'http' : 'https';
  const baseUrl = `${protocol}://${host}`;
  const version = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf-8')).version;

  return (
    <>
      <nav className="nav">
        <div className="nav-inner">
          <span className="nav-wordmark">money</span>
          <div className="nav-links">
            <a href="/skill.md">Skill</a>
            <a href="/money.bundle.js" download>Bundle</a>
          </div>
        </div>
      </nav>

      <main>
        <section className="hero">
          <div className="container">
            <p className="hero-label">Payment Skill for AI Agents</p>
            <h1 className="hero-title">money</h1>
            <p className="hero-desc">
              Send, swap, bridge, and look up prices across 13 chains.
              <br />
              RPCs, addresses, explorer URLs&thinsp;&mdash;&thinsp;all built in.
            </p>
            <div className="hero-actions">
              <a href="#install" className="btn-primary">
                Install
              </a>
              <a href="/skill.md" className="btn-ghost">
                Read the Skill
              </a>
            </div>
          </div>
        </section>

        <div className="divider">
          <span />
        </div>

        <section id="install" className="section">
          <div className="container">
            <h2 className="section-label">Install</h2>
            <div className="install-block">
              <div className="install-text">
                <code className="install-cmd">
                  curl -s {baseUrl}/skill.md
                </code>
                <span className="install-hint">
                  and follow the instructions to install money
                </span>
              </div>
              <CopyButton text={`curl -s ${baseUrl}/skill.md`} />
            </div>
            <p className="section-note">v{version}. Two files. No dependencies.</p>
          </div>
        </section>

        <div className="divider">
          <span />
        </div>

        <section className="section">
          <div className="container">
            <h2 className="section-label">Three Steps</h2>
            <div className="steps">
              <div className="step">
                <span className="step-n">1</span>
                <div className="step-body">
                  <span className="step-name">Setup</span>
                   <code>{'await money.setup({ chain: "fast" })'}</code>
                </div>
              </div>
              <div className="step">
                <span className="step-n">2</span>
                <div className="step-body">
                  <span className="step-name">Balance</span>
                   <code>{'await money.balance({ chain: "fast" })'}</code>
                </div>
              </div>
              <div className="step">
                <span className="step-n">3</span>
                <div className="step-body">
                  <span className="step-name">Send</span>
                   <code>{'await money.send({ to: "set1...", amount: 10, chain: "fast" })'}</code>
                </div>
              </div>
            </div>
            <p className="section-note">
              Same pattern on every chain. Only the name changes.
            </p>
          </div>
        </section>

        <div className="divider">
          <span />
        </div>

        <section className="section">
          <div className="container">
            <h2 className="section-label">Features</h2>
            <div className="features">
              <div className="feature">
                <span className="feature-title">Swap</span>
                <span className="feature-desc">Token swaps via Jupiter (Solana) and Paraswap (EVM)</span>
              </div>
              <div className="feature">
                <span className="feature-title">Bridge</span>
                <span className="feature-desc">Cross-chain bridging via DeBridge</span>
              </div>
              <div className="feature">
                <span className="feature-title">Price</span>
                <span className="feature-desc">Live token prices and pair data via DexScreener</span>
              </div>
              <div className="feature">
                <span className="feature-title">Sign</span>
                <span className="feature-desc">Message signing on any chain</span>
              </div>
              <div className="feature">
                <span className="feature-title">Export</span>
                <span className="feature-desc">Export private keys for wallet backup</span>
              </div>
              <div className="feature">
                <span className="feature-title">Custom Chains</span>
                <span className="feature-desc">Register any EVM chain at runtime</span>
              </div>
            </div>
          </div>
        </section>

        <div className="divider">
          <span />
        </div>

        <section className="section">
          <div className="container">
            <h2 className="section-label">Chains</h2>
            <div className="table-wrap">
              <table className="chain-table">
                <thead>
                  <tr>
                    <th>Chain</th>
                    <th>Token</th>
                    <th>Address</th>
                    <th>Networks</th>
                  </tr>
                </thead>
                <tbody>
                  {chains.map((c) => (
                    <tr key={c.name}>
                      <td className="chain-name-cell">{c.name}</td>
                      <td>
                        <code>{c.token}</code>
                      </td>
                      <td>
                        <code>{c.format}</code>
                      </td>
                      <td>
                        <span className="net">testnet</span>
                        <span className="net">mainnet</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      </main>

      <footer className="footer">
        <div className="container footer-inner">
          <span className="footer-credit">Fast Protocol</span>
          <nav className="footer-nav">
            <a href="/skill.md">Skill</a>
            <a href="/money.bundle.js" download>
              Bundle
            </a>
          </nav>
        </div>
      </footer>
    </>
  );
}
