"use strict";

// Network simulation settings
const CHANCE_DROPPED_MSG = 0;
const MESSAGE_DELAY_RANGE = 0;

// Tendermint settings for delays.
const DELTA = 1000;
const COMMIT_TIME = 10000;

const { Transaction } = require('spartan-gold');

const EOSClient = require('./EOSclient.js');

// Tendermint extensions
const EOSBlockProducer = require('./EOSblock-producer.js');
const EOSBlock = require('./EOSblock.js');
const EOSBlockchain = require('./EOSblockchain.js');

// Simulates problematic network conditions.
const UnreliableNet = require('./unreliable-net.js');

console.log("Starting simulation.  This may take a moment...");

let fakeNet = new UnreliableNet(CHANCE_DROPPED_MSG, MESSAGE_DELAY_RANGE);

// Clients
let alice = new EOSClient({name: "Alice", net: fakeNet});
let bob = new EOSClient({name: "Bob", net: fakeNet});
let charlie = new EOSClient({name: "Charlie", net: fakeNet});

// Miners
let minnie = new EOSBlockProducer({name: "Minnie", net: fakeNet});
let mickey = new EOSBlockProducer({name: "Mickey", net: fakeNet});
let goofy = new EOSBlockProducer({name: "Goofy", net: fakeNet});

let minnie2 = new EOSBlockProducer({name: "Minnie2", net: fakeNet});
let mickey2 = new EOSBlockProducer({name: "Mickey2", net: fakeNet});
let goofy2 = new EOSBlockProducer({name: "Goofy2", net: fakeNet});

let stakedCoins = new Map([
  [alice, 180],
  [bob, 100],
  [charlie, 68],
]);

let votes = new Map([
  [alice, [minnie, minnie2]],
  [bob, [mickey]],
  [charlie, [goofy, goofy2]],
])

let currBlockProducers = [minnie, mickey, minnie2];

// Creating genesis block
EOSBlockchain.makeGenesis({
  blockClass: EOSBlock,
  transactionClass: Transaction,
  confirmedDepth: 3,
  delta: DELTA,
  commitTime: COMMIT_TIME,
  clientBalanceMap: new Map([
    [alice, 233],
    [bob, 100],
    [charlie, 68],
    [minnie, 400],
    [mickey, 300],
    [goofy,  200],
    [minnie2, 400],
    [mickey2, 300],
    [goofy2,  200],
  ]),
  stakedCoins: stakedCoins,
  blockProducers: votes,
  currentBlockProducers: currBlockProducers
});

function showBalances(client) {
  console.log(`Alice has ${client.lastBlock.balanceOf(alice.address)} gold.`);
  console.log(`Bob has ${client.lastBlock.balanceOf(bob.address)} gold.`);
  console.log(`Charlie has ${client.lastBlock.balanceOf(charlie.address)} gold.`);
  console.log(`Minnie has ${client.lastBlock.balanceOf(minnie.address)} gold.`);
  console.log(`Mickey has ${client.lastBlock.balanceOf(mickey.address)} gold.`);
  console.log(`Goofy has ${client.lastBlock.balanceOf(goofy.address)} gold.`);
  console.log(`Minnie2 has ${client.lastBlock.balanceOf(minnie2.address)} gold.`);
  console.log(`Mickey2 has ${client.lastBlock.balanceOf(mickey2.address)} gold.`);
  console.log(`Goofy2 has ${client.lastBlock.balanceOf(goofy2.address)} gold.`);
}

// Showing the initial balances from Alice's perspective, for no particular reason.
console.log("Initial balances:");
showBalances(alice);

fakeNet.register(alice, bob, charlie, minnie, mickey, goofy, minnie2, mickey2, goofy2);

// Miners start mining.
minnie.initialize();
mickey.initialize();
goofy.initialize();
minnie2.initialize();
mickey2.initialize();
goofy2.initialize();

// Alice transfers some money to Bob.
console.log(`Alice is transferring 40 gold to ${bob.address}`);
alice.postTransaction([{ amount: 40, address: bob.address }]);

// Print out the final balances after it has been running for some time.
let foo = () => {

  if (minnie.currentBlock.chainLength < 6) {
    setTimeout(foo, 1000);
    return;
  }

  console.log();
  console.log(`Minnie has a chain of length ${minnie.currentBlock.chainLength}:`);

  console.log();
  console.log(`Mickey has a chain of length ${mickey.currentBlock.chainLength}:`);

  console.log();
  console.log("Final balances (Minnie's perspective):");
  showBalances(minnie);

  console.log();
  console.log("Final balances (Alice's perspective):");
  showBalances(alice);

  console.log();
  console.log("Final balances (Minnie2's perspective):");
  showBalances(minnie2);

  console.log();
  console.log("Final balances (Mickey's perspective):");
  showBalances(mickey);

  console.log();
  console.log("Final balances (Mickey 2's perspective):");
  showBalances(mickey2);

  process.exit(0);
};

setTimeout(foo, 20000);

let boo = () => {
  alice.voteBP([minnie.address]);
  //alice.unstakeGold(180);
  // alice.stakeGold(180);
};

setTimeout(boo, 5000);