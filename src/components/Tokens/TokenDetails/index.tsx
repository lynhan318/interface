import { Trans } from '@lingui/macro'
import { Trace } from '@uniswap/analytics'
import { PageName } from '@uniswap/analytics-events'
import { Currency, NativeCurrency, Token } from '@uniswap/sdk-core'
import { useWeb3React } from '@web3-react/core'
import CurrencyLogo from 'components/CurrencyLogo'
import { AboutSection } from 'components/Tokens/TokenDetails/About'
import AddressSection from 'components/Tokens/TokenDetails/AddressSection'
import BalanceSummary from 'components/Tokens/TokenDetails/BalanceSummary'
import { BreadcrumbNavLink } from 'components/Tokens/TokenDetails/BreadcrumbNavLink'
import ChartSection from 'components/Tokens/TokenDetails/ChartSection'
import MobileBalanceSummaryFooter from 'components/Tokens/TokenDetails/MobileBalanceSummaryFooter'
import ShareButton from 'components/Tokens/TokenDetails/ShareButton'
import TokenDetailsSkeleton, {
  Hr,
  LeftPanel,
  RightPanel,
  TokenDetailsLayout,
  TokenInfoContainer,
  TokenNameCell,
} from 'components/Tokens/TokenDetails/Skeleton'
import StatsSection from 'components/Tokens/TokenDetails/StatsSection'
import { L2NetworkLogo, LogoContainer } from 'components/Tokens/TokenTable/TokenRow'
import TokenSafetyMessage from 'components/TokenSafety/TokenSafetyMessage'
import TokenSafetyModal from 'components/TokenSafety/TokenSafetyModal'
import Widget from 'components/Widget'
import { getChainInfo } from 'constants/chainInfo'
import { SupportedChainId } from 'constants/chains'
import { NATIVE_CHAIN_ID, nativeOnChain } from 'constants/tokens'
import { checkWarning } from 'constants/tokenSafety'
import { TokenPriceQuery } from 'graphql/data/__generated__/TokenPriceQuery.graphql'
import { Chain, TokenQuery } from 'graphql/data/Token'
import { QueryToken, tokenQuery, TokenQueryData } from 'graphql/data/Token'
import { TopToken } from 'graphql/data/TopTokens'
import { CHAIN_NAME_TO_CHAIN_ID } from 'graphql/data/util'
import { useIsUserAddedTokenOnChain } from 'hooks/Tokens'
import { useOnGlobalChainSwitch } from 'hooks/useGlobalChainSwitch'
import { UNKNOWN_TOKEN_SYMBOL, useTokenFromActiveNetwork } from 'lib/hooks/useCurrency'
import useCurrencyLogoURIs from 'lib/hooks/useCurrencyLogoURIs'
import { useCallback, useMemo, useState, useTransition } from 'react'
import { ArrowLeft } from 'react-feather'
import { PreloadedQuery, usePreloadedQuery } from 'react-relay'
import { useNavigate } from 'react-router-dom'
import styled from 'styled-components/macro'
import { isAddress } from 'utils'

import { RefetchPricesFunction } from './ChartSection'
import InvalidTokenDetails from './InvalidTokenDetails'

const TokenSymbol = styled.span`
  text-transform: uppercase;
  color: ${({ theme }) => theme.textSecondary};
`
const TokenActions = styled.div`
  display: flex;
  gap: 16px;
  color: ${({ theme }) => theme.textSecondary};
`

export function useTokenLogoURI(token?: TokenQueryData | TopToken, nativeCurrency?: Token | NativeCurrency) {
  const chainId = token ? CHAIN_NAME_TO_CHAIN_ID[token.chain] : SupportedChainId.MAINNET
  return [
    ...useCurrencyLogoURIs(nativeCurrency),
    ...useCurrencyLogoURIs({ ...token, chainId }),
    token?.project?.logoUrl,
  ][0]
}

function useOnChainToken(address: string | undefined, skip: boolean) {
  const token = useTokenFromActiveNetwork(skip || !address ? undefined : address)

  if (skip || !address || (token && token?.symbol === UNKNOWN_TOKEN_SYMBOL)) {
    return undefined
  } else {
    return token
  }
}

type TokenDetailsProps = {
  urlAddress: string | undefined
  chain: Chain
  tokenQueryReference: PreloadedQuery<TokenQuery>
  priceQueryReference: PreloadedQuery<TokenPriceQuery> | null | undefined
  refetchTokenPrices: RefetchPricesFunction
}
export default function TokenDetails({
  urlAddress,
  chain,
  tokenQueryReference,
  priceQueryReference,
  refetchTokenPrices,
}: TokenDetailsProps) {
  if (!urlAddress) {
    throw new Error('Invalid token details route: tokenAddress param is undefined')
  }
  const address = useMemo(
    () => (urlAddress === NATIVE_CHAIN_ID ? urlAddress : isAddress(urlAddress) || undefined),
    [urlAddress]
  )

  const pageChainId = CHAIN_NAME_TO_CHAIN_ID[chain]
  const { chainId: globalChainId } = useWeb3React()
  const nativeCurrency = nativeOnChain(pageChainId)
  const isNative = address === NATIVE_CHAIN_ID

  const tokenQueryData = usePreloadedQuery(tokenQuery, tokenQueryReference).tokens?.[0]

  const localToken = useMemo(() => {
    if (!address) return undefined
    if (isNative) return nativeCurrency
    if (tokenQueryData) return new QueryToken(tokenQueryData)
    return null
  }, [isNative, nativeCurrency, address, tokenQueryData])
  // fetches on-chain token if query data is missing and page chain matches global chain (else fetch won't work)
  const onChainToken = useOnChainToken(address, Boolean(localToken) || pageChainId !== globalChainId)
  const token = useMemo(() => localToken ?? onChainToken, [localToken, onChainToken])

  const tokenWarning = address ? checkWarning(address) : null
  const isBlockedToken = tokenWarning?.canProceed === false
  const navigate = useNavigate()

  // Wrapping navigate in a transition prevents Suspense from unnecessarily showing fallbacks again.
  const [isPending, startTokenTransition] = useTransition()
  const navigateToTokenForChain = useCallback(
    (newChain: Chain) => {
      if (chain === newChain) return
      const chainName = newChain.toLowerCase()
      // Switches to chain w/ same address if viewing an on-chain token w/ no backend data or a native
      if (!localToken || isNative) {
        startTokenTransition(() => navigate(`/tokens/${chainName}/${address}`))
        return
      }
      const newToken = tokenQueryData?.project?.tokens.find((token) => token.chain === newChain && token.address)
      if (!newToken) return
      startTokenTransition(() => navigate(`/tokens/${chainName}/${newToken.address}`))
    },
    [chain, localToken, isNative, tokenQueryData?.project?.tokens, navigate, address]
  )
  useOnGlobalChainSwitch(navigateToTokenForChain)
  const navigateToWidgetSelectedToken = useCallback(
    (token: Currency) => {
      console.log(token)
      const address = token.isNative ? NATIVE_CHAIN_ID : token.address
      startTokenTransition(() => navigate(`/tokens/${chain.toLowerCase()}/${address}`))
    },
    [chain, navigate]
  )

  const [continueSwap, setContinueSwap] = useState<{ resolve: (value: boolean | PromiseLike<boolean>) => void }>()

  // Show token safety modal if Swap-reviewing a warning token, at all times if the current token is blocked
  const shouldShowSpeedbump = !useIsUserAddedTokenOnChain(address, pageChainId) && tokenWarning !== null
  const onReviewSwapClick = useCallback(
    () => new Promise<boolean>((resolve) => (shouldShowSpeedbump ? setContinueSwap({ resolve }) : resolve(true))),
    [shouldShowSpeedbump]
  )

  const onResolveSwap = useCallback(
    (value: boolean) => {
      continueSwap?.resolve(value)
      setContinueSwap(undefined)
    },
    [continueSwap, setContinueSwap]
  )

  const logoSrc = useTokenLogoURI(tokenQueryData, isNative ? nativeCurrency : undefined)
  const L2Icon = getChainInfo(pageChainId)?.circleLogoUrl

  if (token === undefined) {
    return <InvalidTokenDetails chainName={address && getChainInfo(pageChainId)?.label} />
  }
  return (
    <Trace page={PageName.TOKEN_DETAILS_PAGE} properties={{ address, tokenName: token?.name }} shouldLogImpression>
      <TokenDetailsLayout>
        {token && !isPending ? (
          <LeftPanel>
            <BreadcrumbNavLink to={`/tokens/${chain.toLowerCase()}`}>
              <ArrowLeft size={14} /> Tokens
            </BreadcrumbNavLink>
            <TokenInfoContainer>
              <TokenNameCell>
                <LogoContainer>
                  <CurrencyLogo
                    src={logoSrc}
                    size="32px"
                    symbol={isNative ? nativeCurrency?.symbol : token?.symbol}
                    currency={isNative ? nativeCurrency : token ?? onChainToken}
                  />
                  <L2NetworkLogo networkUrl={L2Icon} size="16px" />
                </LogoContainer>
                {token?.name ?? onChainToken?.name ?? <Trans>Name not found</Trans>}
                <TokenSymbol>{token?.symbol ?? onChainToken?.symbol ?? <Trans>Symbol not found</Trans>}</TokenSymbol>
              </TokenNameCell>
              <TokenActions>
                {tokenQueryData?.name && tokenQueryData.symbol && tokenQueryData.address && (
                  <ShareButton token={tokenQueryData} isNative={!!nativeCurrency} />
                )}
              </TokenActions>
            </TokenInfoContainer>
            <ChartSection priceQueryReference={priceQueryReference} refetchTokenPrices={refetchTokenPrices} />
            <StatsSection
              TVL={tokenQueryData?.market?.totalValueLocked?.value}
              volume24H={tokenQueryData?.market?.volume24H?.value}
              priceHigh52W={tokenQueryData?.market?.priceHigh52W?.value}
              priceLow52W={tokenQueryData?.market?.priceLow52W?.value}
            />
            {!isNative && address && (
              <>
                <Hr />
                <AboutSection
                  address={address}
                  description={tokenQueryData?.project?.description}
                  homepageUrl={tokenQueryData?.project?.homepageUrl}
                  twitterName={tokenQueryData?.project?.twitterName}
                />
                <AddressSection address={address} />
              </>
            )}
          </LeftPanel>
        ) : (
          <TokenDetailsSkeleton />
        )}

        <RightPanel>
          <Widget
            token={token ?? nativeCurrency}
            onTokenChange={navigateToWidgetSelectedToken}
            onReviewSwapClick={onReviewSwapClick}
          />
          {tokenWarning && <TokenSafetyMessage tokenAddress={address ?? ''} warning={tokenWarning} />}
          {token && <BalanceSummary token={token} />}
        </RightPanel>
        {token && <MobileBalanceSummaryFooter token={token} />}

        {address && (
          <TokenSafetyModal
            isOpen={isBlockedToken || !!continueSwap}
            tokenAddress={address}
            onContinue={() => onResolveSwap(true)}
            onBlocked={() => navigate(-1)}
            onCancel={() => onResolveSwap(false)}
            showCancel={true}
          />
        )}
      </TokenDetailsLayout>
    </Trace>
  )
}
