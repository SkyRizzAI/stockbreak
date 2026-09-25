/** docs://guide — short usage guide for LLM clients. */
export const GUIDE = `# Stockbreak MCP guide

Stockbreak is a platform for tokenized stock indexes on Solana (localnet/devnet). Every asset and price is SIMULATED; never present them as real money.

## Research
- list_assets: available stocks, pre-IPO tokens (issued by PreStocks; includes mark price, premium and implied valuation), USDC, with prices.
- list_indexes / get_index / get_index_performance / get_leaderboard / get_portfolio.
- Indexes can be referenced by address or symbol (e.g. "MAG4").

## Acting for a user (human in the loop, default)
- build_join, build_redeem, build_create_index, build_clone store a request and return a signUrl.
- Give the signUrl to the user. They review and sign in their own wallet (Phantom or the dev wallet).
- Poll get_intent_status(intentId) to learn the outcome. Requests expire after 30 minutes.

## Acting as an agent (only when agent_* tools are listed)
- agent_info shows the agent wallet, balances and limits. agent_register marks it as an AI agent.
- agent_create_index / agent_join use the agent's own USDC.
- To rebalance: simulate_rebalance first, then agent_rebalance. The vault program enforces the mandate:
  the swap must reduce drift, respect max slippage and cooldown, and the index must not be paused.
  Keepers (non-managers) can only rebalance when the strategy trigger is met and never trade pre-IPO tokens.
- agent_propose_update changes weights/strategy/fees of indexes the agent created (timelock applies on devnet).
- The agent can never withdraw user funds; a creator can add the agent as a manager so it may rebalance.

## Limits
- Amounts above MCP_MAX_USDC_PER_ACTION are refused.
- Only localnet and devnet are supported.
`;
