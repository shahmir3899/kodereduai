import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { WebView } from 'react-native-webview';
import { parentsApi } from '../../services/api';
import { Colors, FontSize, Spacing, BorderRadius } from '../../constants/colors';

interface Gateway {
  id: string;
  name: string;
  type: string;
  is_active: boolean;
}

export default function Payment() {
  const { studentId, feeId, gateways: gatewaysParam } = useLocalSearchParams<{
    studentId: string;
    feeId: string;
    gateways: string;
  }>();
  const router = useRouter();
  const [selectedGateway, setSelectedGateway] = useState<string | null>(null);
  const [paymentUrl, setPaymentUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  let gateways: Gateway[] = [];
  try {
    gateways = gatewaysParam ? JSON.parse(gatewaysParam) : [];
  } catch {
    gateways = [];
  }

  const initiatePayment = async (gatewayId: string) => {
    setLoading(true);
    setSelectedGateway(gatewayId);
    try {
      const response = await parentsApi.initiatePayment(Number(studentId), {
        fee_payment_id: Number(feeId),
        gateway: gatewayId,
      });
      const data = response.data;
      if (data.payment_url || data.redirect_url) {
        setPaymentUrl(data.payment_url || data.redirect_url);
      } else {
        Alert.alert('Error', 'Payment URL not received. Please try again.');
      }
    } catch (error) {
      console.error('Failed to initiate payment:', error);
      Alert.alert('Error', 'Failed to initiate payment. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleWebViewNavigation = (url: string) => {
    if (url.includes('payment-success') || url.includes('payment/success')) {
      setPaymentUrl(null);
      Alert.alert('Payment Successful', 'Your payment has been processed successfully.', [
        { text: 'OK', onPress: () => router.back() },
      ]);
      return false;
    }
    if (url.includes('payment-failed') || url.includes('payment/failed') || url.includes('payment-cancel')) {
      setPaymentUrl(null);
      Alert.alert('Payment Failed', 'Your payment could not be processed. Please try again.');
      return false;
    }
    return true;
  };

  // WebView Payment
  if (paymentUrl) {
    return (
      <View style={styles.container}>
        <View style={styles.webViewHeader}>
          <TouchableOpacity onPress={() => {
            Alert.alert('Cancel Payment', 'Are you sure you want to cancel this payment?', [
              { text: 'No', style: 'cancel' },
              { text: 'Yes', onPress: () => setPaymentUrl(null) },
            ]);
          }}>
            <Text style={styles.cancelText}>Cancel</Text>
          </TouchableOpacity>
          <Text style={styles.webViewTitle}>Payment</Text>
          <View style={{ width: 60 }} />
        </View>
        <WebView
          source={{ uri: paymentUrl }}
          style={styles.webView}
          onShouldStartLoadWithRequest={(request) => handleWebViewNavigation(request.url)}
          onNavigationStateChange={(navState) => handleWebViewNavigation(navState.url)}
          startInLoadingState
          renderLoading={() => (
            <View style={styles.webViewLoading}>
              <ActivityIndicator size="large" color={Colors.primary} />
              <Text style={styles.loadingText}>Loading payment page...</Text>
            </View>
          )}
        />
      </View>
    );
  }

  // Gateway Selection
  return (
    <View style={styles.container}>
      <View style={styles.content}>
        <Text style={styles.title}>Select Payment Method</Text>
        <Text style={styles.subtitle}>Choose a payment gateway to proceed</Text>

        {gateways.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyText}>No payment gateways available.</Text>
            <TouchableOpacity onPress={() => router.back()}>
              <Text style={styles.goBackText}>Go Back</Text>
            </TouchableOpacity>
          </View>
        ) : (
          gateways.map((gateway) => (
            <TouchableOpacity
              key={gateway.id}
              style={[
                styles.gatewayCard,
                selectedGateway === gateway.id && styles.gatewayCardSelected,
              ]}
              onPress={() => initiatePayment(gateway.id)}
              disabled={loading}
            >
              <View style={styles.gatewayInfo}>
                <Text style={styles.gatewayName}>{gateway.name}</Text>
                <Text style={styles.gatewayType}>{gateway.type}</Text>
              </View>
              {loading && selectedGateway === gateway.id ? (
                <ActivityIndicator size="small" color={Colors.primary} />
              ) : (
                <Text style={styles.gatewayArrow}>›</Text>
              )}
            </TouchableOpacity>
          ))
        )}

        <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
          <Text style={styles.backButtonText}>Go Back</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  content: {
    padding: Spacing.lg,
    flex: 1,
  },
  title: {
    fontSize: FontSize.xl,
    fontWeight: '700',
    color: Colors.text,
    marginBottom: Spacing.sm,
  },
  subtitle: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    marginBottom: Spacing.xxl,
  },
  gatewayCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg,
    padding: Spacing.lg,
    marginBottom: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.border,
    shadowColor: Colors.shadow,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 3,
    elevation: 1,
  },
  gatewayCardSelected: {
    borderColor: Colors.primary,
  },
  gatewayInfo: {},
  gatewayName: {
    fontSize: FontSize.md,
    fontWeight: '600',
    color: Colors.text,
  },
  gatewayType: {
    fontSize: FontSize.xs,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  gatewayArrow: {
    fontSize: 24,
    color: Colors.textTertiary,
  },
  backButton: {
    marginTop: Spacing.xxl,
    alignItems: 'center',
  },
  backButtonText: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    fontWeight: '600',
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: Spacing.xxxl,
  },
  emptyText: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    marginBottom: Spacing.md,
  },
  goBackText: {
    fontSize: FontSize.sm,
    color: Colors.primary,
    fontWeight: '600',
  },
  webViewHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: Spacing.lg,
    backgroundColor: Colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  cancelText: {
    fontSize: FontSize.sm,
    color: Colors.error,
    fontWeight: '600',
  },
  webViewTitle: {
    fontSize: FontSize.md,
    fontWeight: '600',
    color: Colors.text,
  },
  webView: {
    flex: 1,
  },
  webViewLoading: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.background,
  },
  loadingText: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    marginTop: Spacing.md,
  },
});
