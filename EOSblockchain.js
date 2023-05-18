"use strict";

const { Blockchain } = require('spartan-gold');

const BLOCK_PROPOSAL = "BLOCK_PROPOSAL";
const PREVOTE = "PREVOTE";
const PRECOMMIT = "PRECOMMIT";
const COMMIT = "COMMIT";
const NIL = "NIL";

// Default delay settings
const DELTA = 300;
const COMMIT_TIME = 1000;
const BLOCKPRODUCERS = 3;

module.exports = class EOSBlockchain extends Blockchain {
  static get BLOCK_PROPOSAL() { return BLOCK_PROPOSAL; }
  static get PREVOTE() { return PREVOTE; }
  static get PRECOMMIT() { return PRECOMMIT; }
  static get COMMIT() { return COMMIT; }
  static get NIL() { return NIL; }
  static get BLOCKPRODUCERS() { return BLOCKPRODUCERS; }

  static get DELTA() { return Blockchain.cfg.delta; }
  static get COMMIT_TIME() { return Blockchain.cfg.commitTime; }

  static makeGenesis(cfg) {
    // Generating the default genesis block from the parent
    let genesis = Blockchain.makeGenesis(cfg);

    Blockchain.cfg.delta = cfg.delta || DELTA;
    Blockchain.cfg.commitTime = cfg.commitTime || COMMIT_TIME;

    let startingStake = {};

    if (cfg.stakedCoins !== undefined) {
      for (let [client, stake] of cfg.stakedCoins.entries()) {
        startingStake[client.address] = stake;
      }
    }

    // Initializing starting stake and accumulated power in the genesis block.
    Object.keys(startingStake).forEach((addr) => {
      genesis.clientStakes.set(addr, startingStake[addr]);
    });

    let blockProducers = {};

    if (cfg.blockProducers !== undefined) {
      for (let [prod, bps] of cfg.blockProducers.entries()) {
        blockProducers[prod.address] = bps.map(x => x.address);
      }
    }

    Object.keys(blockProducers).forEach((prod) => {
      genesis.blockProducers.set(prod, blockProducers[prod]);
    });

    genesis.currentBlockProducers = cfg.currentBlockProducers.map((x) => x.address);

    return genesis;
  }
};