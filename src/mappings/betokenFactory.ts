import {
    InitFund as InitFundEvent
} from "../../generated/BetokenFactory/BetokenFactory"
import {
    BetokenProxy as BetokenProxyTemplate
} from '../../generated/templates'
import { FundRegistry } from "../../generated/schema"
import * as Utils from '../utils'

export function handleInitFund(event: InitFundEvent): void {
    let fundRegistry = FundRegistry.load('FundRegistry')
    if (fundRegistry == null) {
        fundRegistry = new FundRegistry('FundRegistry')
        fundRegistry.numFunds = Utils.ZERO_INT
        fundRegistry.fundProxies = new Array<string>(0)
    }
    fundRegistry.numFunds = fundRegistry.numFunds.plus(Utils.ONE_INT)
    let proxies = fundRegistry.fundProxies
    proxies.push(event.params.proxy.toHex())
    fundRegistry.fundProxies = proxies
    fundRegistry.save()

    BetokenProxyTemplate.create(event.params.proxy)
}
