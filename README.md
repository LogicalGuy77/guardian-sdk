## Decentralized DDoS Protection with PKP-Controlled State Channels

### Pitch Deck: https://guardian-protocol-4scqwxi.gamma.site/
<pre style="white-space: pre;">
┌─────────────────────────────────────────────────────────────┐
│                    ATTACKER TRAFFIC                         │
│  10,000+ messages/sec hitting Yellow Network broker         │
└─────────────────┬───────────────────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────────────────┐
│              LAYER 1: PKP GUARDIAN NETWORK                  │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐     │
│  │  PKP #1  │  │  PKP #2  │  │  PKP #3  │  │  PKP #4  │     │
│  │ Guardian │  │ Guardian │  │ Guardian │  │ Guardian │     │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘     │
│       │             │             │             │           │
│       └─────────────┴─────────────┴─────────────┘           │
│                     │                                       │
│         Each PKP runs a Lit Action that:                    │
│         - Analyzes message frequency                        │
│         - Checks sender reputation                          │
│         - Validates signatures                              │
│         - Signs "ALLOW" or "BLOCK" decision                 │
└─────────────────┬───────────────────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────────────────┐
│           LAYER 2: YELLOW NETWORK BROKER                    │
│                                                             │
│  - Receives PKP signatures                                  │
│  - Requires 3/4 PKPs to approve (threshold signature)       │
│  - If approved: Process in state channel                    │
│  - If rejected: Submit evidence to Arcology                 │
└─────────────────┬───────────────────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────────────────┐
│          LAYER 3: ARCOLOGY PARALLEL VALIDATION              │
│                                                             │
│  Smart contracts process disputed messages in parallel:     │
│  - Validate PKP signatures                                  │
│  - Analyze attack patterns                                  │
│  - Slash attacker deposits                                  │
│  - Reward PKP guardians                                     │
└─────────────────────────────────────────────────────────────┘
</pre>
