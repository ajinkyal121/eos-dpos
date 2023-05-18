"use strict";

const { Client } = require("spartan-gold");

module.exports = class EOSClient extends Client {
  /**
   * The net object determines how the client communicates
   * with other entities in the system. (This approach allows us to
   * simplify our testing setup.)
   *
   * @constructor
   * @param {Object} obj - The properties of the client.
   * @param {String} [obj.name] - The client's name, used for debugging messages.
   * @param {Object} obj.net - The network used by the client
   *    to send messages to all miners and clients.
   * @param {Block} [obj.startingBlock] - The starting point of the blockchain for the client.
   * @param {Object} [obj.keyPair] - The public private keypair for the client.
   */
  constructor({ name, net, startingBlock, keyPair } = {}) {
    super({ name, net, startingBlock, keyPair });
  }

  // Get current staked gold
  get getStakedGold() {
    return this.lastConfirmedBlock.amountStaked(this.address);
  }

  stakeGold(amount) {
    // Make sure the client has enough gold.
    if (amount < this.availableGold) {
      throw new Error(
        `Requested ${amount}, but account only has ${this.availableGold}.`
      );
    }

    // Create and broadcast the transaction.
    return this.postGenericTransaction({
      data: {
        type: "StakeGold",
        amount: amount,
      },
    });
  }

  unstakeGold(amount) {
    if (amount < this.getStakedGold) {
      throw new Error(
        `Requested ${amount}, but account only has ${this.getStakedGold}.`
      );
    }

    // Create and broadcast the transaction.
    return this.postGenericTransaction({
      data: {
        type: "UnstakeGold",
        amount: amount,
      },
    });
  }

  voteBP(blockProducers) {
    // Create and broadcast the transaction.
    return this.postGenericTransaction({
      data: {
        type: "VoteBP",
        blockProducers: blockProducers,
        totalStake: this.getStakedGold,
      },
    });
  }
};
