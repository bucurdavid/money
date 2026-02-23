import { money } from '/home/deployer/pi/money/dist/index.js';

const TARGET = "set1ld55rskkecy2wflhf0kmfr82ay937tpq7zwmx978udetmqqt2task3fcxc";

async function main() {
  console.log("=== Step 1: Setup Fast wallet ===");
  try {
    const wallet = await money.setup("fast");
    console.log(JSON.stringify(wallet, null, 2));
  } catch (e) {
    console.log("Setup error (may already exist):", e.message);
  }

  console.log("\n=== Step 2: Get testnet tokens from faucet ===");
  try {
    const funded = await money.faucet("fast");
    console.log(JSON.stringify(funded, null, 2));
  } catch (e) {
    console.log("Faucet error:", e.message);
  }

  console.log("\n=== Step 3: Check balance ===");
  try {
    const bal = await money.balance("fast");
    console.log(JSON.stringify(bal, null, 2));
  } catch (e) {
    console.log("Balance error:", e.message);
  }

  console.log("\n=== Step 4: Send 1 SET ===");
  try {
    const tx = await money.send(TARGET, 1);
    console.log(JSON.stringify(tx, null, 2));
  } catch (e) {
    console.log("Send error:", e.message);
  }

  console.log("\n=== Step 5: Generate payment request link for 5 SET ===");
  try {
    const link = await money.request(5, { chain: "fast", memo: "agent payment request" });
    console.log(JSON.stringify(link, null, 2));
  } catch (e) {
    console.log("Request error:", e.message);
  }
}

main().catch(e => console.error("Fatal:", e));
