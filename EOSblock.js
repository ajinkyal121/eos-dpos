"use strict";

const { Block } = require("spartan-gold");
module.exports = class EOSBlock extends Block {
  /**
   * A StakeBlock must keep track of amount of coins staked,
   * as well as the accumulated power for proposing the
   * selected block.
   */
  constructor(rewardAddr, prevBlock, target, coinbaseReward) {
    super(rewardAddr, prevBlock, target, coinbaseReward);

    // Tracking current balances of staked gold
    this.clientStakes =
      prevBlock && prevBlock.clientStakes
        ? new Map(prevBlock.clientStakes)
        : new Map();

    this.blockProducers =
      prevBlock && prevBlock.blockProducers
        ? new Map(prevBlock.blockProducers)
        : new Map();

    this.currentBlockProducers =
      prevBlock && prevBlock.currentBlockProducers
        ? [...prevBlock.currentBlockProducers]
        : [];

    this.setCurrentBlockProducers();
  }

  setCurrentBlockProducers() {
    if (this.chainLength % 3 == 0) {
      let temp = new Map();
      for (let [addr, bps] of this.blockProducers) {
        let share = this.clientStakes.get(addr) / bps.length;
        bps.forEach((blockProducer) => {
          temp.set(
            blockProducer,
            (temp.get(blockProducer) || 0) + share
          );
        });
      }
      this.currentBlockProducers = this.getTop3Keys(temp);
    }
  }

  getTop3Keys(map) {
    const sortedEntries = Array.from(map.entries()).sort((a, b) => b[1] - a[1]);
    const topEntries = sortedEntries.slice(0, 3);
    return topEntries.map((entry) => entry[0]);
  }

  /**
   * Returns the amount of gold staked by the specified user address.
   * If no gold is staked, 0 is returned.
   */
  amountStaked(addr) {
    return this.clientStakes.get(addr) || 0;
  }

  /**
   * When rerunning a locking block, we must also replay the calculation
   * of accumulated power for determining the block proposer.
   *
   * @param {Block} prevBlock - The previous block in the blockchain, used for initial balances.
   *
   * @returns {Boolean} - True if the block's transactions are all valid.
   */
  rerun(prevBlock) {
    this.clientStakes = new Map(prevBlock.clientStakes);

    this.blockProducers = new Map(prevBlock.blockProducers);

    if (this.chainLength % 3 == 0) {
      this.setCurrentBlockProducers();
    } else {
      this.currentBlockProducers = [...prevBlock.currentBlockProducers];
    }

    return super.rerun(prevBlock);
  }

  hasValidProof() {
    return true;
  }

  /**
   * Accepts a new transaction if it is valid and adds it to the block.
   *
   * @param {Transaction} tx - The transaction to add to the block.
   * @param {Client} [client] - A client object, for logging useful messages.
   *
   * @returns {Boolean} - True if the transaction was added successfully.
   */
  addTransaction(tx, client) {
    if (this.transactions.get(tx.id)) {
      if (client) client.log(`Duplicate transaction ${tx.id}.`);
      return false;
    } else if (tx.sig === undefined) {
      if (client) client.log(`Unsigned transaction ${tx.id}.`);
      return false;
    } else if (!tx.validSignature()) {
      if (client) client.log(`Invalid signature for transaction ${tx.id}.`);
      return false;
    } else if (!tx.sufficientFunds(this)) {
      if (client) client.log(`Insufficient gold for transaction ${tx.id}.`);
      return false;
    }

    // Checking and updating nonce value.
    // This portion prevents replay attacks.
    let nonce = this.nextNonce.get(tx.from) || 0;
    if (tx.nonce < nonce) {
      if (client) client.log(`Replayed transaction ${tx.id}.`);
      return false;
    } else if (tx.nonce > nonce) {
      // FIXME: Need to do something to handle this case more gracefully.
      if (client) client.log(`Out of order transaction ${tx.id}.`);
      return false;
    } else {
      this.nextNonce.set(tx.from, nonce + 1);
    }

    // Adding the transaction to the block
    this.transactions.set(tx.id, tx);

    // Run smart contracts giving gold to the specified output addresses
    switch (tx.data.type) {
      case "StakeGold": {
        if (!this.clientStakes.get(tx.from)) {
          this.clientStakes.set(tx.from, tx.data.amount);
          break;
        }
        this.clientStakes.set(
          tx.from,
          this.clientStakes.get(tx.from) + tx.data.amount
        );
        break;
      }
      case "UnstakeGold": {
        this.clientStakes.set(
          tx.from,
          this.clientStakes.get(tx.from) - tx.data.amount
        );
        break;
      }
      case "VoteBP": {
        this.blockProducers.set(tx.from, tx.data.blockProducers);
        break;
      }
    }

    // Taking gold from the sender
    let senderBalance = this.balanceOf(tx.from);
    this.balances.set(tx.from, senderBalance - tx.totalOutput());

    // Giving gold to the specified output addresses
    tx.outputs.forEach(({ amount, address }) => {
      let oldBalance = this.balanceOf(address);
      this.balances.set(address, amount + oldBalance);
    });

    return true;
  }
};
