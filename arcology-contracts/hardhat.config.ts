import type { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import net from "./network.json";

const config: HardhatUserConfig = {
  solidity: "0.8.28",
  networks: net
};

export default config;
