"use strict";
const fs = require("fs");
const path = require("path");
const { ethers } = require("hardhat");

const BUILD_DIR = path.join(__dirname, "..", "..", "build");

function loadArtifact(name) {
  const p = path.join(BUILD_DIR, `${name}.json`);
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

async function deploy(name, signer, ...args) {
  const artifact = loadArtifact(name);
  const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, signer);
  const contract = await factory.deploy(...args);
  await contract.waitForDeployment();
  return contract;
}

function attach(name, address, signerOrProvider) {
  const artifact = loadArtifact(name);
  return new ethers.Contract(address, artifact.abi, signerOrProvider);
}

module.exports = { loadArtifact, deploy, attach };
