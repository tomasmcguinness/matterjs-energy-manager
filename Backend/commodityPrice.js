import {
    Attribute, OptionalAttribute, BitFlag, ClusterRegistry, MutableCluster,
    TlvArray, TlvEnum, TlvEpochS, TlvField, TlvInt16, TlvInt64, TlvNullable,
    TlvObject, TlvOptionalField, TlvString, TlvUInt16, TlvUInt32, TlvUInt8,
} from "@matter/main/types";

/*
 * The Commodity Price cluster (0x0095), which a pricing server uses to
 * publish the current electricity price and a forecast of upcoming prices.
 *
 * It was added in Matter 1.5, after the version of matter.js we use, so it is
 * defined here. Only the attributes are included, as that's all we read.
 */
export const TariffUnit = { KWh: 0, KVAh: 1 };

const TlvCurrency = TlvObject({
    currency: TlvField(0, TlvUInt16.bound({ max: 999 })), // ISO 4217 numeric code
    decimalPoints: TlvField(1, TlvUInt8),
});

const TlvCommodityPriceComponent = TlvObject({
    price: TlvField(0, TlvInt64),
    source: TlvField(1, TlvEnum()),
    description: TlvOptionalField(2, TlvString.bound({ maxLength: 32 })),
    tariffComponentId: TlvOptionalField(3, TlvUInt32),
});

const TlvCommodityPrice = TlvObject({
    periodStart: TlvField(0, TlvEpochS),
    periodEnd: TlvField(1, TlvNullable(TlvEpochS)),
    price: TlvOptionalField(2, TlvInt64),
    priceLevel: TlvOptionalField(3, TlvInt16),
    description: TlvOptionalField(4, TlvString.bound({ maxLength: 32 })),
    components: TlvOptionalField(5, TlvArray(TlvCommodityPriceComponent, { maxLength: 10 })),
});

export const CommodityPrice = MutableCluster({
    id: 0x0095,
    name: "CommodityPrice",
    revision: 4,
    features: {
        forecasting: BitFlag(0),
    },
    attributes: {
        tariffUnit: Attribute(0, TlvEnum()),
        currency: Attribute(1, TlvNullable(TlvCurrency)),
        currentPrice: Attribute(2, TlvNullable(TlvCommodityPrice)),
        priceForecast: OptionalAttribute(3, TlvArray(TlvCommodityPrice, { maxLength: 56 })),
    },
});

// Registering it lets the controller decode the cluster's attributes. This
// must happen before the controller connects to any nodes.
//
ClusterRegistry.register(CommodityPrice);
