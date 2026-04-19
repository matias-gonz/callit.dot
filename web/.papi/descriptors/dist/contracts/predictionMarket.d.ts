import type { InkDescriptors } from 'polkadot-api/ink';
import type { HexString, Enum } from 'polkadot-api';
type Address = HexString;
type StorageDescriptor = {};
type MessagesDescriptor = {
    "buyShares": {
        message: {
            "marketId": bigint;
            "outcome": boolean;
        };
        response: {};
    };
    "claimWinnings": {
        message: {
            "marketId": bigint;
        };
        response: {};
    };
    "createMarket": {
        message: {
            "question": string;
            "resolutionTimestamp": bigint;
        };
        response: {
            "marketId": bigint;
        };
    };
    "disputeResolution": {
        message: {
            "marketId": bigint;
        };
        response: {};
    };
    "disputeWindow": {
        message: {};
        response: bigint;
    };
    "getMarket": {
        message: {
            "marketId": bigint;
        };
        response: {
            "creator": Address;
            "question": string;
            "resolutionTimestamp": bigint;
            "state": number;
            "proposedOutcome": boolean;
            "yesPool": bigint;
            "noPool": bigint;
        };
    };
    "getMarketCount": {
        message: {};
        response: bigint;
    };
    "getUserPosition": {
        message: {
            "marketId": bigint;
            "user": Address;
        };
        response: {
            "yesDeposit": bigint;
            "noDeposit": bigint;
        };
    };
    "godResolve": {
        message: {
            "marketId": bigint;
            "outcome": boolean;
        };
        response: {};
    };
    "owner": {
        message: {};
        response: Address;
    };
    "renounceOwnership": {
        message: {};
        response: {};
    };
    "resolutionBond": {
        message: {};
        response: bigint;
    };
    "resolveMarket": {
        message: {
            "marketId": bigint;
            "outcome": boolean;
        };
        response: {};
    };
    "setDisputeWindow": {
        message: {
            "duration": bigint;
        };
        response: {};
    };
    "setResolutionBond": {
        message: {
            "amount": bigint;
        };
        response: {};
    };
    "transferOwnership": {
        message: {
            "newOwner": Address;
        };
        response: {};
    };
};
type ConstructorsDescriptor = {
    "new": {
        message: {
            "initialResolutionBond": bigint;
            "initialDisputeWindow": bigint;
        };
        response: {};
    };
};
type EventDescriptor = Enum<{
    "DisputeRaised": {
        "marketId": bigint;
        "disputer": Address;
    };
    "MarketCreated": {
        "marketId": bigint;
        "creator": Address;
        "question": string;
        "resolutionTimestamp": bigint;
    };
    "MarketFinalized": {
        "marketId": bigint;
        "outcome": boolean;
    };
    "MarketResolved": {
        "marketId": bigint;
        "resolver": Address;
        "outcome": boolean;
    };
    "OwnershipTransferred": {
        "previousOwner": Address;
        "newOwner": Address;
    };
    "SharesBought": {
        "marketId": bigint;
        "buyer": Address;
        "outcome": boolean;
        "amount": bigint;
    };
    "WinningsClaimed": {
        "marketId": bigint;
        "claimant": Address;
        "amount": bigint;
    };
}>;
export declare const descriptor: InkDescriptors<StorageDescriptor, MessagesDescriptor, ConstructorsDescriptor, EventDescriptor>;
export {};
