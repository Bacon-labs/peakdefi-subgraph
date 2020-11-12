# Deployment Readme

## Step 1: Update contract addresses

Update the contract addresses in `subgraph.yaml` to the correct values.

## Step 2: Update latest block number

Update `LATEST_BLOCK` in `src/utils.ts` with the latest Ethereum block number (probably plus some offset). The block handler in `src/peakdefiFund.ts` will begin making updates after `LATEST_BLOCK`, which will slow down syncing, so an appropriate value is best for syncing quickly.

## Step 2: Install npm packages

Run `npm install`

## Step 3: Codegen

Run `npx graph codegen`

## Step 4: Deploy

Run `npx graph deploy --node https://api.thegraph.com/deploy/ --ipfs https://api.thegraph.com/ipfs/ [graphName] --access-token [accessToken]`, where `[graphName]` is replaced with the name of your subgraph on thegraph.com (e.g. PEAKDEFI/peakdefi-subgraph), and `[accessToken]` is replaced with the thegraph.com access token of your account, which can be found at https://thegraph.com/explorer/dashboard
