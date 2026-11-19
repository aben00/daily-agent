// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../src/DailyAgent.sol";

/// @notice End-to-end test against the REAL Agent ID registry on a pinned
///         BSC fork. Run with: forge test --match-contract DailyAgentForkTest
///         (RPC responses are cached by Foundry, so repeat runs are cheap).
contract DailyAgentForkTest is Test {
    // SPACE ID Agent ID registry, BNB Chain (verified in the task brief).
    address public constant REGISTRY = 0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F;
    // The user's wallet — holds Agent ID "taitai".
    address public constant USER = 0x4dbC1aFeDD4424Bf29a09f2477D190A9A709B889;

    DailyAgent public dailyAgent;

    function setUp() public {
        // Pinned BSC block (2026-11-19). Fork state is cached locally.
        uint256 fork = vm.createFork(
            "https://bsc-dataseed.binance.org", 134_461_610
        );
        vm.selectFork(fork);
        dailyAgent = new DailyAgent(REGISTRY, "https://aben00.github.io/daily-agent/meta/");
    }

    function test_UserWalletHoldsAgentID() public view {
        uint256 bal = IAgentIDRegistry(REGISTRY).balanceOf(USER);
        assertGt(bal, 0, "user wallet should hold an Agent ID");
    }

    function test_UserCanCheckInOnRealRegistry() public {
        vm.prank(USER);
        dailyAgent.checkIn();

        assertEq(dailyAgent.ownerOf(1), USER);
        assertEq(dailyAgent.totalCheckIns(USER), 1);
        assertEq(dailyAgent.currentStreak(USER), 1);
        assertEq(
            dailyAgent.tokenURI(1), "https://aben00.github.io/daily-agent/meta/1"
        );
    }

    function test_NonHolderRevertsOnRealRegistry() public {
        address stranger = address(0x5EED);
        assertEq(IAgentIDRegistry(REGISTRY).balanceOf(stranger), 0);
        vm.prank(stranger);
        vm.expectRevert("no Agent ID");
        dailyAgent.checkIn();
    }

    function test_CheckInGasFirstDay() public {
        vm.prank(USER);
        uint256 g = gasleft();
        dailyAgent.checkIn();
        emit log_named_uint("checkIn gas (first day, cold storage)", g - gasleft());
    }

    function test_CheckInGasSecondDay() public {
        vm.prank(USER);
        dailyAgent.checkIn();
        vm.warp(block.timestamp + 1 days);
        vm.prank(USER);
        uint256 g = gasleft();
        dailyAgent.checkIn();
        emit log_named_uint("checkIn gas (second day)", g - gasleft());
    }
}
