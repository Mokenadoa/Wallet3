import { Button, Coin, Separator, TextBox } from '../../../components';
import { FlatList, ListRenderItemInfo, Text, TouchableOpacity, View } from 'react-native';
import React, { useState } from 'react';

import { ERC20Token } from '../../../models/ERC20';
import { IToken } from '../../../common/tokens';
import Theme from '../../../viewmodels/settings/Theme';
import { formatCurrency } from '../../../utils/formatter';
import { observer } from 'mobx-react-lite';
import { startLayoutAnimation } from '../../../utils/animations';
import { utils } from 'ethers';

interface Props {
  tokens: IToken[];
  selectedToken?: IToken;
  chainId: number;
  themeColor?: string;
  onTokenSelected?: (token: IToken) => void;
}

export default observer((props: Props) => {
  const { textColor, borderColor, secondaryTextColor, isLightMode, foregroundColor, tintColor, backgroundColor } = Theme;
  const [filterTxt, setFilterTxt] = useState('');
  const [userToken, setUserToken] = useState<ERC20Token>();

  const handleInput = async (txt: string) => {
    if (!utils.isAddress(txt)) {
      setFilterTxt(txt);
      return;
    }

    setFilterTxt('');

    const token = new ERC20Token({ contract: utils.getAddress(txt), chainId: props.chainId, owner: txt });

    try {
      await Promise.all([token.getDecimals(), token.getSymbol(), token.getBalance()]);
    } catch (error) {
      return;
    }

    setUserToken(token);
    startLayoutAnimation();
  };

  const renderItem = ({ item }: ListRenderItemInfo<IToken>) => {
    const opacity = props.selectedToken?.address === item.address ? 0.25 : 1;

    return (
      <TouchableOpacity
        onPress={() => props.onTokenSelected?.(item)}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          margin: 0,
          padding: 8,
          paddingVertical: 12,
        }}
      >
        <Coin
          address={item.address}
          chainId={1}
          symbol={item.symbol}
          size={29}
          style={{ marginEnd: 12, opacity }}
          iconUrl={item.iconUrl}
          forceRefresh
        />
        <Text style={{ fontSize: 19, color: textColor, opacity }} numberOfLines={1}>
          {item.symbol}
        </Text>

        <View style={{ flex: 1 }} />

        <Text style={{ fontSize: 19, color: secondaryTextColor, opacity }}>{formatCurrency(item.amount || 0, '')}</Text>
      </TouchableOpacity>
    );
  };

  return (
    <View style={{ padding: 16, paddingBottom: 0 }}>
      <TextBox
        iconColor={isLightMode ? `${foregroundColor}80` : tintColor}
        style={{ marginBottom: 16 }}
        placeholder={'Coin symbol or address'}
        onChangeText={(t) => handleInput(t)}
      />

      {userToken ? (
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            paddingStart: 8,
            paddingEnd: 0,
            paddingTop: 0,
            paddingBottom: 12,
            backgroundColor,
          }}
        >
          <Coin forceRefresh size={29} address={userToken.address} symbol={userToken.symbol} chainId={userToken.chainId} />
          <Text style={{ marginStart: 12, fontSize: 19 }}>{userToken.symbol}</Text>
          <View style={{ flex: 1 }} />

          <TouchableOpacity style={{ paddingHorizontal: 6, paddingVertical: 4 }}>
            <Text style={{ fontSize: 20, color: props.themeColor, fontWeight: '500', textTransform: 'uppercase' }}>Add</Text>
          </TouchableOpacity>
        </View>
      ) : undefined}

      <Text style={{ marginBottom: 4, color: secondaryTextColor, paddingHorizontal: 8 }}>Tokens</Text>
      <Separator style={{ borderColor }} />

      <FlatList
        data={filterTxt ? props.tokens.filter((t) => t.symbol.toLowerCase().includes(filterTxt.toLowerCase())) : props.tokens}
        renderItem={renderItem}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 24, paddingTop: 4 }}
        style={{ marginHorizontal: -16, height: 420 }}
      />
    </View>
  );
});
