// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @notice Minimal interface of the SPACE ID Agent ID registry (ERC-721,
/// non-transferable, one per user). An address holds an Agent ID iff
/// balanceOf(address) > 0.
interface IAgentIDRegistry {
    function balanceOf(address owner) external view returns (uint256);
}

/// @notice ERC-721 receiver hook (needed for safe mints to contracts).
interface IERC721Receiver {
    function onERC721Received(address operator, address from, uint256 tokenId, bytes calldata data)
        external
        returns (bytes4);
}

/// @title DailyAgent — daily check-in badges for Agent ID holders
/// @notice One free check-in per UTC day per Agent ID holder. Each check-in
///         mints a badge NFT (sequential tokenIds from 1). The contract has
///         NO owner, NO fees, NO pause, NO admin functions of any kind:
///         the registry address and baseURI are fixed at deploy time and
///         can never be changed afterwards.
contract DailyAgent {
    /*//////////////////////////////////////////////////////////////
                                 ERC-721
    //////////////////////////////////////////////////////////////*/

    string public name = "DailyAgent Badge";
    string public symbol = "DAGENT";

    mapping(uint256 => address) internal _owners;
    mapping(address => uint256) internal _balances;
    mapping(uint256 => address) internal _tokenApprovals;
    mapping(address => mapping(address => bool)) internal _operatorApprovals;

    event Transfer(address indexed from, address indexed to, uint256 indexed tokenId);
    event Approval(address indexed owner, address indexed approved, uint256 indexed tokenId);
    event ApprovalForAll(address indexed owner, address indexed operator, bool approved);

    function balanceOf(address owner) public view returns (uint256) {
        require(owner != address(0), "zero address");
        return _balances[owner];
    }

    function ownerOf(uint256 tokenId) public view returns (address) {
        address owner = _owners[tokenId];
        require(owner != address(0), "nonexistent token");
        return owner;
    }

    function getApproved(uint256 tokenId) public view returns (address) {
        require(_owners[tokenId] != address(0), "nonexistent token");
        return _tokenApprovals[tokenId];
    }

    function isApprovedForAll(address owner, address operator) public view returns (bool) {
        return _operatorApprovals[owner][operator];
    }

    function approve(address to, uint256 tokenId) public {
        address owner = _owners[tokenId];
        require(to != owner, "approve to owner");
        require(
            msg.sender == owner || _operatorApprovals[owner][msg.sender], "not authorized"
        );
        _tokenApprovals[tokenId] = to;
        emit Approval(owner, to, tokenId);
    }

    function setApprovalForAll(address operator, bool approved) public {
        require(operator != msg.sender, "approve to self");
        _operatorApprovals[msg.sender][operator] = approved;
        emit ApprovalForAll(msg.sender, operator, approved);
    }

    function transferFrom(address from, address to, uint256 tokenId) public {
        require(_isApprovedOrOwner(msg.sender, tokenId), "not authorized");
        _transfer(from, to, tokenId);
    }

    function safeTransferFrom(address from, address to, uint256 tokenId) public {
        safeTransferFrom(from, to, tokenId, "");
    }

    function safeTransferFrom(address from, address to, uint256 tokenId, bytes memory data)
        public
    {
        require(_isApprovedOrOwner(msg.sender, tokenId), "not authorized");
        _safeTransfer(from, to, tokenId, data);
    }

    function supportsInterface(bytes4 interfaceId) public pure returns (bool) {
        return interfaceId == 0x01ffc9a7 // ERC165
            || interfaceId == 0x80ac58cd // ERC721
            || interfaceId == 0x5b5e139f; // ERC721Metadata
    }

    function _isApprovedOrOwner(address spender, uint256 tokenId) internal view returns (bool) {
        address owner = _owners[tokenId];
        return spender == owner || _tokenApprovals[tokenId] == spender
            || _operatorApprovals[owner][spender];
    }

    function _transfer(address from, address to, uint256 tokenId) internal {
        require(_owners[tokenId] == from, "wrong owner");
        require(to != address(0), "transfer to zero");
        delete _tokenApprovals[tokenId];
        unchecked {
            _balances[from] -= 1;
            _balances[to] += 1;
        }
        _owners[tokenId] = to;
        emit Transfer(from, to, tokenId);
    }

    function _safeTransfer(address from, address to, uint256 tokenId, bytes memory data)
        internal
    {
        _transfer(from, to, tokenId);
        require(
            _checkOnERC721Received(from, to, tokenId, data), "not ERC721Receiver"
        );
    }

    function _mint(address to, uint256 tokenId) internal {
        require(to != address(0), "mint to zero");
        require(_owners[tokenId] == address(0), "already minted");
        unchecked {
            _balances[to] += 1;
        }
        _owners[tokenId] = to;
        emit Transfer(address(0), to, tokenId);
    }

    function _safeMint(address to, uint256 tokenId) internal {
        _mint(to, tokenId);
        require(
            _checkOnERC721Received(address(0), to, tokenId, ""), "not ERC721Receiver"
        );
    }

    function _checkOnERC721Received(address from, address to, uint256 tokenId, bytes memory data)
        private
        returns (bool)
    {
        if (to.code.length == 0) return true;
        try IERC721Receiver(to).onERC721Received(msg.sender, from, tokenId, data) returns (
            bytes4 retval
        ) {
            return retval == IERC721Receiver.onERC721Received.selector;
        } catch {
            return false;
        }
    }

    /*//////////////////////////////////////////////////////////////
                               CHECK-IN
    //////////////////////////////////////////////////////////////*/

    /// @notice The Agent ID registry. Fixed forever at deploy time.
    IAgentIDRegistry public immutable registry;
    /// @notice Base URI for badge metadata. Set once in the constructor;
    ///         there is no setter, so it can never be changed afterwards.
    ///         tokenURI(tokenId) = baseURI + tokenId (decimal, no extension).
    string public baseURI;

    uint256 public nextTokenId;
    uint256 public totalCheckInsGlobal;
    mapping(address => uint256) public lastCheckInDay;
    mapping(address => uint256) public totalCheckIns;
    mapping(address => uint256) public currentStreak;

    event CheckIn(
        address indexed user, uint256 indexed tokenId, uint256 day, uint256 streak
    );

    constructor(address _registry, string memory _baseURI) {
        require(_registry != address(0), "zero registry");
        registry = IAgentIDRegistry(_registry);
        baseURI = _baseURI;
    }

    /// @notice Check in for today (UTC day). Free — no value, no fee.
    ///         Requires the caller to hold an Agent ID. One check-in per
    ///         UTC day per wallet. Mints a badge NFT to the caller.
    function checkIn() external {
        require(registry.balanceOf(msg.sender) > 0, "no Agent ID");
        uint256 day = block.timestamp / 1 days;
        require(lastCheckInDay[msg.sender] != day, "already checked in today");

        uint256 streak = 1;
        if (day > 0 && lastCheckInDay[msg.sender] == day - 1) {
            streak = currentStreak[msg.sender] + 1;
        }
        lastCheckInDay[msg.sender] = day;
        currentStreak[msg.sender] = streak;
        totalCheckIns[msg.sender] += 1;
        totalCheckInsGlobal += 1;

        uint256 tokenId = ++nextTokenId;
        _safeMint(msg.sender, tokenId);
        emit CheckIn(msg.sender, tokenId, day, streak);
    }

    /// @notice tokenURI = baseURI + tokenId (e.g. https://.../meta/1).
    function tokenURI(uint256 tokenId) public view returns (string memory) {
        require(_owners[tokenId] != address(0), "nonexistent token");
        return string(abi.encodePacked(baseURI, _toString(tokenId)));
    }

    function _toString(uint256 value) internal pure returns (string memory) {
        if (value == 0) return "0";
        uint256 temp = value;
        uint256 digits;
        while (temp != 0) {
            digits++;
            temp /= 10;
        }
        bytes memory buffer = new bytes(digits);
        while (value != 0) {
            digits -= 1;
            // forge-lint: disable-next-line(unsafe-typecast)
            // 48 + (value % 10) is at most 57, always fits in uint8.
            buffer[digits] = bytes1(uint8(48 + uint256(value % 10)));
            value /= 10;
        }
        return string(buffer);
    }
}
