// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../src/DailyAgent.sol";

/// @notice Deploys DailyAgent to BNB Chain (56).
/// @dev DRY-RUN ONLY in this repo: run WITHOUT --broadcast to simulate.
///      Real deployment (parent): fund the deployer, then
///        forge script script/Deploy.s.sol --rpc-url https://bsc-dataseed.binance.org \
///          --broadcast --sender 0x4dbC1aFeDD4424Bf29a09f2477D190A9A709B889
///      (signing is done by the parent's wallet flow, never by this script
///      alone — the script takes no private key argument here on purpose.)
contract Deploy is Script {
    address public constant REGISTRY = 0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F;
    string public constant BASE_URI = "https://aben00.github.io/daily-agent/meta/";

    function run() external {
        vm.startBroadcast();
        DailyAgent dailyAgent = new DailyAgent(REGISTRY, BASE_URI);
        vm.stopBroadcast();

        console.log("DailyAgent deployed at:", address(dailyAgent));
        console.log("registry:", address(dailyAgent.registry()));
        console.log("baseURI:", dailyAgent.baseURI());
        console.log("name:", dailyAgent.name());
        console.log("symbol:", dailyAgent.symbol());
    }
}
