import React, { useRef, useState } from 'react';

import { Account } from '../../viewmodels/account/Account';
import App from '../../viewmodels/App';
import { Confirm } from '../views/Confirm';
import EditAccount from './EditAccount';
import MainPanel from './MainPanel';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import Swiper from 'react-native-swiper';
import { formatAddress } from '../../utils/formatter';
import i18n from '../../i18n';
import { observer } from 'mobx-react-lite';
import rootStyles from '../styles';

export default observer(() => {
  const { t } = i18n;
  const swiper = useRef<Swiper>(null);
  const [type, setType] = useState('');
  const [account, setAccount] = useState<Account>();

  const onRemoveAccount = (account: Account) => {
    setType('removeAccount');
    setAccount(account);
    setTimeout(() => swiper.current?.scrollTo(1), 0);
  };

  const removeAccount = () => {
    if (!account) return;
    App.removeAccount(account);
    swiper.current?.scrollBy(-1);
    setAccount(undefined);
  };

  const cancelRemoveAccount = () => {
    swiper.current?.scrollBy(-1);
    setTimeout(() => setType(''), 500);
  };

  const editAccount = (account: Account) => {
    setType('editAccount');
    setAccount(account);
    setTimeout(() => swiper.current?.scrollTo(1), 0);
  };

  return (
    <SafeAreaProvider style={rootStyles.safeArea}>
      <Swiper
        ref={swiper}
        showsPagination={false}
        showsButtons={false}
        scrollEnabled={false}
        loop={false}
        automaticallyAdjustContentInsets
      >
        <MainPanel onRemoveAccount={onRemoveAccount} onEditAccount={editAccount} />
        {type === 'removeAccount' && (
          <Confirm
            confirmButtonTitle={t('button-confirm')}
            cancelButtonTitle={t('button-cancel')}
            onConfirm={removeAccount}
            onCancel={cancelRemoveAccount}
            style={{ flex: 1 }}
            themeColor="crimson"
            desc={t('modal-multi-accounts-remove-account-desc', { addr: account?.displayName })}
            cancelable
          />
        )}

        {type === 'editAccount' && <EditAccount account={account} />}
      </Swiper>
    </SafeAreaProvider>
  );
});
