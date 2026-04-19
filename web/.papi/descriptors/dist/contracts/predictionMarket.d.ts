import type { InkDescriptors } from 'polkadot-api/ink';
import type { HexString, Enum } from 'polkadot-api';
type Address = HexString;
type StorageDescriptor = {};
type MessagesDescriptor = {
    "createMarket": {
        message: {
            "question": string;
            "resolutionTimestamp": bigint;
        };
        response: {
            "marketId": bigint;
        };
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
        };
    };
    "getMarketCount": {
        message: {};
        response: bigint;
    };
};
type ConstructorsDescriptor = {
    "new": {
        message: {};
        response: {};
    };
};
type EventDescriptor = Enum<{
    "MarketCreated": {
        "marketId": bigint;
        "creator": Address;
        "question": string;
        "resolutionTimestamp": bigint;
    };
}>;
export declare const descriptor: InkDescriptors<StorageDescriptor, MessagesDescriptor, ConstructorsDescriptor, EventDescriptor>;
export {};
