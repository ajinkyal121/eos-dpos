"use strict";

const { Miner } = require("spartan-gold");

const Proposal = require("./proposal.js");
const EOSBlockchain = require("./EOSblockchain.js");
const Vote = require("./vote.js");

module.exports = class EOSBlockProducer extends Miner {
  constructor(...args) {
    super(...args);

    // Storing transactions for next block.
    this.myTransactions = new Set();
  }

  /**
   * Starts listeners and begins block production.
   */
  initialize() {
    this.startNewSearch();

    this.on(EOSBlockchain.POST_TRANSACTION, this.addTransaction);

    // Listeners to collect proposals and votes.
    this.on(EOSBlockchain.BLOCK_PROPOSAL, this.collectProposal);
    this.on(EOSBlockchain.PREVOTE, this.collectPrevote);
    this.on(EOSBlockchain.PRECOMMIT, this.collectPrecommit);
    this.on(EOSBlockchain.COMMIT, this.collectCommit);

    // Collection buckets for proposals and blocks.
    this.proposals = [];
    this.proposedBlocks = {};

    // Tracking votes
    this.prevotes = {};
    this.precommits = {};
    this.commits = {};

    // Start block production
    setTimeout(() => this.newRound(), 0);
  }

  /**
   * In addition to other responsibilities related to searching for a new block,
   * the accumulated power must be copied over for the round.
   */
  startNewSearch() {
    super.startNewSearch();

    // Tracking height/round for the proposal.
    this.height = this.currentBlock.chainLength;
    this.round = 0;
  }

  /**
   * Verifies that a vote is valid and stores it in the ballotBox
   * if it is.  If there is Byzantine behavior, an exception will
   * be raised.
   *
   * @param {Vote} vote - A vote of whatever kind.
   * @param {Object} ballotBox - The collection of votes.
   */
  verifyAndVote(vote, ballotBox) {
    vote = new Vote(vote);

    if (!vote.isValid(this)) {
      return;
    }

    // Check for Byzantine votes
    out: if (ballotBox[vote.from] !== undefined) {
      let currentVote = ballotBox[vote.from];

      if (vote.fresherThan(currentVote)) {
        // Replace stale vote with new one.
        break out;
      } else if (currentVote.fresherThan(vote)) {
        // Ignore a stale vote.
        return;
      }

      if (currentVote.id === vote.id) {
        // If vote is a duplicate, just ignore it.
        return;
      } else {
        this.postEvidenceTransaction(vote.from, currentVote, vote);
      }
    }

    // If we made it here, store the validator's vote.
    ballotBox[vote.from] = vote;
  }

  /**
   * This method counts the number of votes for a specified block,
   * where the keys identify the blocks and the values represent
   * the total number of votes (amount of stake) for that block.
   *
   * @param {Object} ballotBox - Collection of votes, blockID -> amount votes.
   *
   * @returns ID of the winning block.
   */
  countVotes(ballotBox) {
    let totalStake = EOSBlockchain.BLOCKPRODUCERS;
    let votesNeeded = (2 * totalStake) / 3;

    let candidateBlocks = {};

    let winningBlockID = undefined;

    Object.keys(ballotBox).forEach((voterAddr) => {
      // let stake = this.currentBlock.amountGoldBonded(voterAddr);
      let vote = ballotBox[voterAddr];

      // Ignore stale votes (unless they are commits)
      if (vote.isStale(this.height, this.round)) {
        return;
      }

      let blockID = vote.blockID;
      let currentVotes = candidateBlocks[blockID] || 0;
      currentVotes += 1;
      candidateBlocks[blockID] = currentVotes;
      //this.log(`...${vote.from} votes for ${blockID} (${this.height}-${this.round}) with ${stake} votes`);
      if (currentVotes > votesNeeded) {
        if (blockID === EOSBlockchain.NIL) {
          winningBlockID = EOSBlockchain.NIL;
        } else {
          winningBlockID = vote.blockID;
        }
      }
    });

    return winningBlockID;
  }

  /**
   * Start a new round to come to consensus on a block.
   */
  newRound() {
    // If we have committed to a block, we don't do any more rounds
    // until we reach a new height.
    if (this.nextBlock !== undefined) return;

    // Update the round count.
    this.round++;

    this.determineProposer();

    // If the validator is the proposer, propose a block.
    if (this.address === this.currentProposer) {
      this.proposeBlock();
    }

    // We wait to collect proposals before we choose one.
    setTimeout(() => this.prevote(), this.round * EOSBlockchain.DELTA);
  }

  /**
   * Determines the block proposer based on their "accumulated power".
   * It uses a weighted round-robin algorithm where validators with
   * more stake propose blocks more often.
   */
  determineProposer() {
    let blockProposers = this.currentBlock.currentBlockProducers;
    this.currentProposer = blockProposers[this.height % blockProposers.length];

    console.log('blockProducers', blockProposers);
    this.log(
      `The block proposer for ${this.height}-${this.round} is ${this.currentProposer}`
    );
  }

  /**
   * Makes a proposal for a block, as defined by the proposal class.
   *
   * Note that there should be a "proof-of-lock", but we are omitting
   * it for simplicity.  Note that doing so does open us up to some
   * attacks.
   */
  proposeBlock() {
    this.currentBlock = EOSBlockchain.makeBlock(this.address, this.lastBlock);

    // Add queued-up transactions to block.
    this.myTransactions.forEach((tx) => {
      this.currentBlock.addTransaction(tx, this);
    });
    this.myTransactions.clear();

    this.log(
      `Proposing block ${this.currentBlock.id} for round ${this.currentBlock.chainLength}-${this.round}.`
    );

    this.shareProposal(this.currentBlock);
  }

  /**
   * Signs and broadcasts a block proposal.
   *
   * @param {EOSBlock} block - Proposed block.
   */
  shareProposal(block) {
    let proposal = new Proposal({
      from: this.address,
      block: block,
      blockID: block.id,
      height: this.height,
      round: this.round,
      pubKey: this.keyPair.public,
    });

    proposal.sign(this.keyPair.private);

    this.net.broadcast(EOSBlockchain.BLOCK_PROPOSAL, proposal);
  }

  /**
   * This method collects proposals until the wall time.
   * It also stores the proposed block for later use.
   *
   * @param {Proposal} proposal - A proposal for a new block, along with some metadata.
   */
  collectProposal(proposal) {
    this.proposals.push(new Proposal(proposal));
    let block = EOSBlockchain.deserializeBlock(proposal.block);

    // If we don't have the previous block, we don't accept the block.
    // Fetching the missing blocks will be triggered if the block is
    // actually accepted.
    let prevBlock = this.blocks.get(block.prevBlockHash);
    if (prevBlock === undefined) return;

    // // Otherwise, we rerun the block to update balances/etc. and store it.
    block.rerun(prevBlock);
    this.proposedBlocks[proposal.blockID] = block;
  }


  prevote() {
    let vote = undefined;

    if (this.currentBlock.currentBlockProducers.includes(this.address)) {
      vote = Vote.makeVote(
        this,
        EOSBlockchain.PREVOTE,
        this.proposals[0].blockID
      );

      this.log(`Voting for block ${vote.blockID}`);

      this.net.broadcast(EOSBlockchain.PREVOTE, vote);
    }

    this.proposals = [];

    // After voting, set timer before determining precommit.
    setTimeout(() => this.precommit(), this.round * EOSBlockchain.DELTA);
  }

  /**
   * Validates prevote, saving it if it is a valid vote.
   * This step will also catch any attempts to double-vote.
   *
   * @param {Vote} vote - incoming vote.
   */
  collectPrevote(vote) {
    this.verifyAndVote(vote, this.prevotes);
  }

  precommit() {
    let winningBlockID = this.countVotes(this.prevotes);
    this.prevotes = {};

    if (this.currentBlock.currentBlockProducers.includes(this.address)) {
      if (winningBlockID === EOSBlockchain.NIL) {
        delete this.lockedBlock;
      } else if (winningBlockID !== undefined) {
        // Lock on that block
        this.lockedBlock = this.proposeBlock[winningBlockID];
        this.net.broadcast(
          EOSBlockchain.PRECOMMIT,
          Vote.makeVote(this, EOSBlockchain.PRECOMMIT, winningBlockID)
        );
      }
    }

    // Setting to decide on whether to commit.
    setTimeout(() => this.commitDecision(), this.round * EOSBlockchain.DELTA);
  }

  /**
   * Validates precommit vote, saving it if it is a valid vote.
   * This step will also catch any attempts to double-vote.
   *
   * @param {Vote} vote - incoming vote.
   */
  collectPrecommit(precommit) {
    this.verifyAndVote(precommit, this.precommits);
  }

  /**
   * If 2/3 precommits are received, the validator commits.
   * Otherwise, it begins a new round.
   */
  commitDecision() {
    let winningBlockID = this.countVotes(this.precommits);
    this.precommits = {};

    if (winningBlockID !== EOSBlockchain.NIL && winningBlockID !== undefined) {
      this.commit(winningBlockID);
    } else {
      this.newRound();
    }
  }

  commit(winningBlockID) {
    this.log(
      `Committing to block ${winningBlockID}`
    );

    this.nextBlock = this.proposedBlocks[winningBlockID];

    if (this.currentBlock.currentBlockProducers.includes(this.address)) {
      this.net.broadcast(
        EOSBlockchain.COMMIT,
        Vote.makeVote(this, EOSBlockchain.COMMIT, winningBlockID)
      );
    }

    setTimeout(() => this.finalizeCommit(), this.round * EOSBlockchain.DELTA);
  }

  /**
   * Validates commit vote, saving it if it is a valid vote.
   * This step will also catch any attempts to double-vote.
   *
   * @param {Vote} vote - incoming vote.
   */
  collectCommit(commit) {
    this.verifyAndVote(commit, this.commits);
  }

  /**
   * Once we have committed, we wait until we received 2/3 of (weighted) commits
   * from other validators.
   */
  finalizeCommit() {
    let winningBlockID = this.countVotes(this.commits);

    if (winningBlockID === undefined) {
      // If we have less than 2/3 commits, wait longer.
      this.log(
        `No consensus on ${this.nextBlock.id} (${this.height}-${this.round}) yet.  Waiting...`
      );
      setTimeout(() => this.finalizeCommit(), EOSBlockchain.DELTA);
    } else {
      this.commits = {};
      setTimeout(() => this.newHeight(), EOSBlockchain.COMMIT_TIME);
    }
  }

  /**
   * Once we have received commits from 2/3 of validators (weighted by their stake),
   * we begin looking for the next block.
   */
  newHeight() {
    // Announce new block.
    this.currentBlock = this.nextBlock;
    this.announceProof();

    // Release our locks.
    delete this.nextBlock;
    delete this.lockedBlock;

    // Start working on the next block.
    this.receiveBlock(this.currentBlock);
    this.startNewSearch();
    this.newRound();
  }

  /**
   * In contrast to the standard version of SpartanGold, we queue up transactions
   * for the next block.  This change is required, because otherwise all signatures
   * would be invalid if we added a new transaction.
   *
   * @param {Transaction} tx - The transaction we wish to add to the block.
   */
  addTransaction(tx) {
    tx = EOSBlockchain.makeTransaction(tx);
    this.myTransactions.add(tx);
  }

  /**
   *
   * @param faultyAddr - The address of the Byzantine validator.
   * @param oldMessage - The proposal or vote we had received previously.
   * @param newMessage - The conflicting proposal/vote.
   */
  postEvidenceTransaction(faultyAddr, oldMessage, newMessage) {
    throw new Error(`
      Possible Byzantine behavior by ${faultyAddr}.
      Received conflicting messages:
      -> ${JSON.stringify(oldMessage)}
      -> ${JSON.stringify(newMessage)}`);
  }

  /**
   * Utility method that displays all confirmed balances for all clients,
   * according to the client's own perspective of the network.
   */
  showAllBalances() {
    this.log("Showing balances:");
    for (let [id, balance] of this.lastConfirmedBlock.balances) {
      console.log(`    ${id}: ${balance}`);
    }
  }
};
