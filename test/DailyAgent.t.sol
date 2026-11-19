// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../src/DailyAgent.sol";

/// @notice Stand-in for the SPACE ID Agent ID registry in unit tests.
contract MockAgentID {
    mapping(address => uint256) public balances;

    function setBalance(address user, uint256 amount) external {
        balances[user] = amount;
    }

    function balanceOf(address owner) external view returns (uint256) {
        return balances[owner];
    }
}

contract DailyAgentTest is Test {
    DailyAgent public dailyAgent;
    MockAgentID public registry;

    address public holder = address(0xA11CE);
    address public holder2 = address(0xB0B);
    address public stranger = address(0x5EED);

    string public constant BASE = "https://aben00.github.io/daily-agent/meta/";

    function setUp() public {
        registry = new MockAgentID();
        registry.setBalance(holder, 1);
        registry.setBalance(holder2, 1);
        // stranger holds no Agent ID
        dailyAgent = new DailyAgent(address(registry), BASE);
        // Pin the clock to a clean UTC-day boundary so day math is exact.
        vm.warp(1_800_000_000); // 2027-01-15 08:00:00 UTC, day 20833
    }

    function test_RevertWhenNoAgentID() public {
        vm.prank(stranger);
        vm.expectRevert("no Agent ID");
        dailyAgent.checkIn();
    }

    function test_CheckInMintsBadge() public {
        vm.prank(holder);
        dailyAgent.checkIn();

        assertEq(dailyAgent.ownerOf(1), holder);
        assertEq(dailyAgent.balanceOf(holder), 1);
        assertEq(dailyAgent.totalCheckIns(holder), 1);
        assertEq(dailyAgent.currentStreak(holder), 1);
        assertEq(dailyAgent.lastCheckInDay(holder), block.timestamp / 1 days);
        assertEq(dailyAgent.totalCheckInsGlobal(), 1);
        assertEq(dailyAgent.nextTokenId(), 1);
    }

    function test_TokenURICorrect() public {
        vm.prank(holder);
        dailyAgent.checkIn();
        assertEq(dailyAgent.tokenURI(1), string.concat(BASE, "1"));

        vm.warp(block.timestamp + 1 days);
        vm.prank(holder);
        dailyAgent.checkIn();
        assertEq(dailyAgent.tokenURI(2), string.concat(BASE, "2"));
    }

    function test_TokenURIRevertsForNonexistent() public {
        vm.expectRevert("nonexistent token");
        dailyAgent.tokenURI(1);
    }

    function test_RevertSecondCheckInSameDay() public {
        vm.prank(holder);
        dailyAgent.checkIn();

        vm.prank(holder);
        vm.expectRevert("already checked in today");
        dailyAgent.checkIn();
    }

    function test_NextDayCheckInSucceeds() public {
        vm.prank(holder);
        dailyAgent.checkIn();

        vm.warp(block.timestamp + 1 days);
        vm.prank(holder);
        dailyAgent.checkIn();

        assertEq(dailyAgent.ownerOf(2), holder);
        assertEq(dailyAgent.balanceOf(holder), 2);
        assertEq(dailyAgent.totalCheckIns(holder), 2);
        assertEq(dailyAgent.currentStreak(holder), 2);
        assertEq(dailyAgent.totalCheckInsGlobal(), 2);
    }

    function test_StreakIncrementsOnConsecutiveDays() public {
        for (uint256 i = 0; i < 5; i++) {
            vm.prank(holder);
            dailyAgent.checkIn();
            assertEq(dailyAgent.currentStreak(holder), i + 1);
            vm.warp(block.timestamp + 1 days);
        }
        assertEq(dailyAgent.totalCheckIns(holder), 5);
        assertEq(dailyAgent.nextTokenId(), 5);
    }

    function test_StreakResetsAfterMissedDay() public {
        vm.prank(holder);
        dailyAgent.checkIn();
        assertEq(dailyAgent.currentStreak(holder), 1);

        vm.warp(block.timestamp + 1 days);
        vm.prank(holder);
        dailyAgent.checkIn();
        assertEq(dailyAgent.currentStreak(holder), 2);

        // Skip a whole day (no check-in on the next day).
        vm.warp(block.timestamp + 2 days);
        vm.prank(holder);
        dailyAgent.checkIn();
        assertEq(dailyAgent.currentStreak(holder), 1);
        assertEq(dailyAgent.totalCheckIns(holder), 3);
    }

    function test_TotalCheckInsCountsPerUserAndGlobal() public {
        vm.prank(holder);
        dailyAgent.checkIn();
        vm.prank(holder2);
        dailyAgent.checkIn();

        assertEq(dailyAgent.totalCheckIns(holder), 1);
        assertEq(dailyAgent.totalCheckIns(holder2), 1);
        assertEq(dailyAgent.totalCheckIns(stranger), 0);
        assertEq(dailyAgent.totalCheckInsGlobal(), 2);

        vm.warp(block.timestamp + 1 days);
        vm.prank(holder);
        dailyAgent.checkIn();

        assertEq(dailyAgent.totalCheckIns(holder), 2);
        assertEq(dailyAgent.totalCheckInsGlobal(), 3);
    }

    function test_CheckInEmitsEvent() public {
        uint256 day = block.timestamp / 1 days;
        vm.expectEmit(true, true, false, true);
        emit DailyAgent.CheckIn(holder, 1, day, 1);
        vm.prank(holder);
        dailyAgent.checkIn();
    }

    function test_BadgeIsTransferableERC721() public {
        vm.prank(holder);
        dailyAgent.checkIn();

        vm.prank(holder);
        dailyAgent.transferFrom(holder, holder2, 1);

        assertEq(dailyAgent.ownerOf(1), holder2);
        assertEq(dailyAgent.balanceOf(holder), 0);
        assertEq(dailyAgent.balanceOf(holder2), 1);
        // Check-in stats stay with the checker, not the badge.
        assertEq(dailyAgent.totalCheckIns(holder), 1);
    }

    function test_NoOwnerNoAdmin() public {
        // The contract exposes no owner() and no admin setters: the only
        // state-changing function besides ERC-721 transfers is checkIn().
        // Registry and baseURI are immutable — verify they cannot change
        // by reading them back after a check-in.
        address regBefore = address(dailyAgent.registry());
        string memory uriBefore = dailyAgent.baseURI();

        vm.prank(holder);
        dailyAgent.checkIn();

        assertEq(address(dailyAgent.registry()), regBefore);
        assertEq(dailyAgent.baseURI(), uriBefore);
    }

    function test_CheckInIsFree() public {
        // checkIn() is nonpayable: sending value must revert.
        vm.prank(holder);
        (bool ok,) = address(dailyAgent).call{value: 1 wei}(
            abi.encodeWithSelector(DailyAgent.checkIn.selector)
        );
        assertFalse(ok, "checkIn accepted value");
    }
}
