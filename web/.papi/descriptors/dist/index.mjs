import {
  __export
} from "./chunk-7P6ASYW6.mjs";

// .papi/descriptors/src/common.ts
var table = new Uint8Array(128);
for (let i = 0; i < 64; i++) table[i < 26 ? i + 65 : i < 52 ? i + 71 : i < 62 ? i - 4 : i * 4 - 205] = i;
var toBinary = (base64) => {
  const n = base64.length, bytes = new Uint8Array((n - Number(base64[n - 1] === "=") - Number(base64[n - 2] === "=")) * 3 / 4 | 0);
  for (let i2 = 0, j = 0; i2 < n; ) {
    const c0 = table[base64.charCodeAt(i2++)], c1 = table[base64.charCodeAt(i2++)];
    const c2 = table[base64.charCodeAt(i2++)], c3 = table[base64.charCodeAt(i2++)];
    bytes[j++] = c0 << 2 | c1 >> 4;
    bytes[j++] = c1 << 4 | c2 >> 2;
    bytes[j++] = c2 << 6 | c3;
  }
  return bytes;
};

// .papi/descriptors/src/callit.ts
var descriptorValues = import("./descriptors-SCOPULBW.mjs").then((module) => module["Callit"]);
var metadataTypes = import("./metadataTypes-3ANJPBLF.mjs").then(
  (module) => toBinary("default" in module ? module.default : module)
);
var asset = {};
var extensions = {};
var getMetadata = () => import("./callit_metadata-ZOPUGMVJ.mjs").then(
  (module) => toBinary("default" in module ? module.default : module)
);
var genesis = void 0;
var _allDescriptors = { descriptors: descriptorValues, metadataTypes, asset, extensions, getMetadata, genesis };
var callit_default = _allDescriptors;

// .papi/descriptors/src/bulletin.ts
var descriptorValues2 = import("./descriptors-SCOPULBW.mjs").then((module) => module["Bulletin"]);
var metadataTypes2 = import("./metadataTypes-3ANJPBLF.mjs").then(
  (module) => toBinary("default" in module ? module.default : module)
);
var asset2 = {};
var extensions2 = {};
var getMetadata2 = () => import("./bulletin_metadata-CV52PCEZ.mjs").then(
  (module) => toBinary("default" in module ? module.default : module)
);
var genesis2 = void 0;
var _allDescriptors2 = { descriptors: descriptorValues2, metadataTypes: metadataTypes2, asset: asset2, extensions: extensions2, getMetadata: getMetadata2, genesis: genesis2 };
var bulletin_default = _allDescriptors2;

// .papi/descriptors/src/paseoHub.ts
var descriptorValues3 = import("./descriptors-SCOPULBW.mjs").then((module) => module["PaseoHub"]);
var metadataTypes3 = import("./metadataTypes-3ANJPBLF.mjs").then(
  (module) => toBinary("default" in module ? module.default : module)
);
var asset3 = {};
var extensions3 = {};
var getMetadata3 = () => import("./paseoHub_metadata-AECIC2AT.mjs").then(
  (module) => toBinary("default" in module ? module.default : module)
);
var genesis3 = "0xd6eec26135305a8ad257a20d003357284c8aa03d0bdb2b357ab0a22371e11ef2";
var _allDescriptors3 = { descriptors: descriptorValues3, metadataTypes: metadataTypes3, asset: asset3, extensions: extensions3, getMetadata: getMetadata3, genesis: genesis3 };
var paseoHub_default = _allDescriptors3;

// .papi/descriptors/src/common-types.ts
import { _Enum } from "polkadot-api";
var DigestItem = _Enum;
var Phase = _Enum;
var DispatchClass = _Enum;
var TokenError = _Enum;
var ArithmeticError = _Enum;
var TransactionalError = _Enum;
var BalanceStatus = _Enum;
var TransactionPaymentEvent = _Enum;
var XcmV5Junctions = _Enum;
var XcmV5Junction = _Enum;
var XcmV5NetworkId = _Enum;
var XcmV3JunctionBodyId = _Enum;
var XcmV2JunctionBodyPart = _Enum;
var XcmV5Instruction = _Enum;
var XcmV3MultiassetFungibility = _Enum;
var XcmV3MultiassetAssetInstance = _Enum;
var XcmV3MaybeErrorCode = _Enum;
var XcmV2OriginKind = _Enum;
var XcmV5AssetFilter = _Enum;
var XcmV5WildAsset = _Enum;
var XcmV2MultiassetWildFungibility = _Enum;
var XcmV3WeightLimit = _Enum;
var XcmVersionedAssets = _Enum;
var XcmV3MultiassetAssetId = _Enum;
var XcmV3Junctions = _Enum;
var XcmV3Junction = _Enum;
var XcmV3JunctionNetworkId = _Enum;
var XcmVersionedLocation = _Enum;
var UpgradeGoAhead = _Enum;
var UpgradeRestriction = _Enum;
var BalancesTypesReasons = _Enum;
var TransactionPaymentReleases = _Enum;
var XcmV3Response = _Enum;
var XcmV3TraitsError = _Enum;
var XcmV4Response = _Enum;
var XcmPalletVersionMigrationStage = _Enum;
var XcmVersionedAssetId = _Enum;
var MultiAddress = _Enum;
var BalancesAdjustmentDirection = _Enum;
var XcmVersionedXcm = _Enum;
var XcmV3Instruction = _Enum;
var XcmV3MultiassetMultiAssetFilter = _Enum;
var XcmV3MultiassetWildMultiAsset = _Enum;
var XcmV4Instruction = _Enum;
var XcmV4AssetAssetFilter = _Enum;
var XcmV4AssetWildAsset = _Enum;
var TransactionValidityUnknownTransaction = _Enum;
var TransactionValidityTransactionSource = _Enum;
var XcmVersionedAsset = _Enum;
var PreimageEvent = _Enum;
var PreimagePalletHoldReason = _Enum;
var CommonClaimsEvent = _Enum;
var ConvictionVotingVoteAccountVote = _Enum;
var PreimagesBounded = _Enum;
var ChildBountiesEvent = _Enum;
var NominationPoolsPoolState = _Enum;
var NominationPoolsCommissionClaimPermission = _Enum;
var NominationPoolsClaimPermission = _Enum;
var BagsListEvent = _Enum;
var StakingRewardDestination = _Enum;
var StakingForcing = _Enum;
var PreimageOldRequestStatus = _Enum;
var PreimageRequestStatus = _Enum;
var GovernanceOrigin = _Enum;
var WestendRuntimeRuntimeFreezeReason = _Enum;
var NominationPoolsPalletFreezeReason = _Enum;
var Version = _Enum;
var ClaimsStatementKind = _Enum;
var TreasuryPaymentState = _Enum;
var ConvictionVotingVoteVoting = _Enum;
var VotingConviction = _Enum;
var TraitsScheduleDispatchTime = _Enum;
var ChildBountyStatus = _Enum;
var ReferendaTypesCurve = _Enum;
var NominationPoolsBondExtra = _Enum;
var StakingPalletConfigOpBig = _Enum;
var StakingPalletConfigOp = _Enum;
var NominationPoolsConfigOp = _Enum;

// .papi/descriptors/src/contracts/index.ts
var contracts_exports = {};
__export(contracts_exports, {
  predictionMarket: () => descriptor
});

// .papi/descriptors/src/contracts/predictionMarket.ts
var descriptor = { abi: [{ "inputs": [{ "internalType": "uint256", "name": "initialResolutionBond", "type": "uint256" }, { "internalType": "uint256", "name": "initialDisputeWindow", "type": "uint256" }], "stateMutability": "nonpayable", "type": "constructor" }, { "inputs": [{ "internalType": "address", "name": "owner", "type": "address" }], "name": "OwnableInvalidOwner", "type": "error" }, { "inputs": [{ "internalType": "address", "name": "account", "type": "address" }], "name": "OwnableUnauthorizedAccount", "type": "error" }, { "anonymous": false, "inputs": [{ "indexed": true, "internalType": "uint256", "name": "marketId", "type": "uint256" }, { "indexed": true, "internalType": "address", "name": "disputer", "type": "address" }], "name": "DisputeRaised", "type": "event" }, { "anonymous": false, "inputs": [{ "indexed": true, "internalType": "uint256", "name": "marketId", "type": "uint256" }, { "indexed": true, "internalType": "address", "name": "creator", "type": "address" }, { "indexed": false, "internalType": "string", "name": "question", "type": "string" }, { "indexed": false, "internalType": "uint256", "name": "resolutionTimestamp", "type": "uint256" }], "name": "MarketCreated", "type": "event" }, { "anonymous": false, "inputs": [{ "indexed": true, "internalType": "uint256", "name": "marketId", "type": "uint256" }, { "indexed": false, "internalType": "bool", "name": "outcome", "type": "bool" }], "name": "MarketFinalized", "type": "event" }, { "anonymous": false, "inputs": [{ "indexed": true, "internalType": "uint256", "name": "marketId", "type": "uint256" }, { "indexed": true, "internalType": "address", "name": "resolver", "type": "address" }, { "indexed": false, "internalType": "bool", "name": "outcome", "type": "bool" }], "name": "MarketResolved", "type": "event" }, { "anonymous": false, "inputs": [{ "indexed": true, "internalType": "address", "name": "previousOwner", "type": "address" }, { "indexed": true, "internalType": "address", "name": "newOwner", "type": "address" }], "name": "OwnershipTransferred", "type": "event" }, { "anonymous": false, "inputs": [{ "indexed": true, "internalType": "uint256", "name": "marketId", "type": "uint256" }, { "indexed": true, "internalType": "address", "name": "buyer", "type": "address" }, { "indexed": false, "internalType": "bool", "name": "outcome", "type": "bool" }, { "indexed": false, "internalType": "uint256", "name": "amount", "type": "uint256" }], "name": "SharesBought", "type": "event" }, { "anonymous": false, "inputs": [{ "indexed": true, "internalType": "uint256", "name": "marketId", "type": "uint256" }, { "indexed": true, "internalType": "address", "name": "claimant", "type": "address" }, { "indexed": false, "internalType": "uint256", "name": "amount", "type": "uint256" }], "name": "WinningsClaimed", "type": "event" }, { "inputs": [{ "internalType": "uint256", "name": "marketId", "type": "uint256" }, { "internalType": "bool", "name": "outcome", "type": "bool" }], "name": "buyShares", "outputs": [], "stateMutability": "payable", "type": "function" }, { "inputs": [{ "internalType": "uint256", "name": "marketId", "type": "uint256" }], "name": "claimWinnings", "outputs": [], "stateMutability": "nonpayable", "type": "function" }, { "inputs": [{ "internalType": "string", "name": "question", "type": "string" }, { "internalType": "uint256", "name": "resolutionTimestamp", "type": "uint256" }], "name": "createMarket", "outputs": [{ "internalType": "uint256", "name": "marketId", "type": "uint256" }], "stateMutability": "nonpayable", "type": "function" }, { "inputs": [{ "internalType": "uint256", "name": "marketId", "type": "uint256" }], "name": "disputeResolution", "outputs": [], "stateMutability": "payable", "type": "function" }, { "inputs": [], "name": "disputeWindow", "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }], "stateMutability": "view", "type": "function" }, { "inputs": [{ "internalType": "uint256", "name": "marketId", "type": "uint256" }], "name": "getMarket", "outputs": [{ "internalType": "address", "name": "creator", "type": "address" }, { "internalType": "string", "name": "question", "type": "string" }, { "internalType": "uint256", "name": "resolutionTimestamp", "type": "uint256" }, { "internalType": "enum PredictionMarket.State", "name": "state", "type": "uint8" }, { "internalType": "bool", "name": "proposedOutcome", "type": "bool" }, { "internalType": "uint256", "name": "yesPool", "type": "uint256" }, { "internalType": "uint256", "name": "noPool", "type": "uint256" }], "stateMutability": "view", "type": "function" }, { "inputs": [], "name": "getMarketCount", "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }], "stateMutability": "view", "type": "function" }, { "inputs": [{ "internalType": "uint256", "name": "marketId", "type": "uint256" }, { "internalType": "address", "name": "user", "type": "address" }], "name": "getUserPosition", "outputs": [{ "internalType": "uint256", "name": "yesDeposit", "type": "uint256" }, { "internalType": "uint256", "name": "noDeposit", "type": "uint256" }], "stateMutability": "view", "type": "function" }, { "inputs": [{ "internalType": "uint256", "name": "marketId", "type": "uint256" }, { "internalType": "bool", "name": "outcome", "type": "bool" }], "name": "godResolve", "outputs": [], "stateMutability": "nonpayable", "type": "function" }, { "inputs": [], "name": "owner", "outputs": [{ "internalType": "address", "name": "", "type": "address" }], "stateMutability": "view", "type": "function" }, { "inputs": [], "name": "renounceOwnership", "outputs": [], "stateMutability": "nonpayable", "type": "function" }, { "inputs": [], "name": "resolutionBond", "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }], "stateMutability": "view", "type": "function" }, { "inputs": [{ "internalType": "uint256", "name": "marketId", "type": "uint256" }, { "internalType": "bool", "name": "outcome", "type": "bool" }], "name": "resolveMarket", "outputs": [], "stateMutability": "payable", "type": "function" }, { "inputs": [{ "internalType": "uint256", "name": "duration", "type": "uint256" }], "name": "setDisputeWindow", "outputs": [], "stateMutability": "nonpayable", "type": "function" }, { "inputs": [{ "internalType": "uint256", "name": "amount", "type": "uint256" }], "name": "setResolutionBond", "outputs": [], "stateMutability": "nonpayable", "type": "function" }, { "inputs": [{ "internalType": "address", "name": "newOwner", "type": "address" }], "name": "transferOwnership", "outputs": [], "stateMutability": "nonpayable", "type": "function" }] };

// .papi/descriptors/src/index.ts
var metadatas = { ["0x3b36085f46d6213d6f5a2fb26415d7c46da8e397977f2f7404ac431931ab5ae6"]: paseoHub_default };
var getMetadata4 = async (codeHash) => {
  try {
    return await metadatas[codeHash].getMetadata();
  } catch {
  }
  return null;
};
export {
  ArithmeticError,
  BagsListEvent,
  BalanceStatus,
  BalancesAdjustmentDirection,
  BalancesTypesReasons,
  ChildBountiesEvent,
  ChildBountyStatus,
  ClaimsStatementKind,
  CommonClaimsEvent,
  ConvictionVotingVoteAccountVote,
  ConvictionVotingVoteVoting,
  DigestItem,
  DispatchClass,
  GovernanceOrigin,
  MultiAddress,
  NominationPoolsBondExtra,
  NominationPoolsClaimPermission,
  NominationPoolsCommissionClaimPermission,
  NominationPoolsConfigOp,
  NominationPoolsPalletFreezeReason,
  NominationPoolsPoolState,
  Phase,
  PreimageEvent,
  PreimageOldRequestStatus,
  PreimagePalletHoldReason,
  PreimageRequestStatus,
  PreimagesBounded,
  ReferendaTypesCurve,
  StakingForcing,
  StakingPalletConfigOp,
  StakingPalletConfigOpBig,
  StakingRewardDestination,
  TokenError,
  TraitsScheduleDispatchTime,
  TransactionPaymentEvent,
  TransactionPaymentReleases,
  TransactionValidityTransactionSource,
  TransactionValidityUnknownTransaction,
  TransactionalError,
  TreasuryPaymentState,
  UpgradeGoAhead,
  UpgradeRestriction,
  Version,
  VotingConviction,
  WestendRuntimeRuntimeFreezeReason,
  XcmPalletVersionMigrationStage,
  XcmV2JunctionBodyPart,
  XcmV2MultiassetWildFungibility,
  XcmV2OriginKind,
  XcmV3Instruction,
  XcmV3Junction,
  XcmV3JunctionBodyId,
  XcmV3JunctionNetworkId,
  XcmV3Junctions,
  XcmV3MaybeErrorCode,
  XcmV3MultiassetAssetId,
  XcmV3MultiassetAssetInstance,
  XcmV3MultiassetFungibility,
  XcmV3MultiassetMultiAssetFilter,
  XcmV3MultiassetWildMultiAsset,
  XcmV3Response,
  XcmV3TraitsError,
  XcmV3WeightLimit,
  XcmV4AssetAssetFilter,
  XcmV4AssetWildAsset,
  XcmV4Instruction,
  XcmV4Response,
  XcmV5AssetFilter,
  XcmV5Instruction,
  XcmV5Junction,
  XcmV5Junctions,
  XcmV5NetworkId,
  XcmV5WildAsset,
  XcmVersionedAsset,
  XcmVersionedAssetId,
  XcmVersionedAssets,
  XcmVersionedLocation,
  XcmVersionedXcm,
  bulletin_default as bulletin,
  callit_default as callit,
  contracts_exports as contracts,
  getMetadata4 as getMetadata,
  paseoHub_default as paseoHub
};
