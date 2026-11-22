import * as cognito from 'aws-cdk-lib/aws-cognito';
import type { Construct } from 'constructs';

/**
 * Purr's managed login style: nakostat's dark layout with Purr's warm ginger accent
 * (for Mu). Cognito ties each style to one app client.
 */
export function purrManagedLoginBranding(
  scope: Construct,
  id: string,
  props: { userPoolId: string; clientId: string; logo: Buffer },
): cognito.CfnManagedLoginBranding {
  return new cognito.CfnManagedLoginBranding(scope, id, {
    userPoolId: props.userPoolId,
    clientId: props.clientId,
    useCognitoProvidedValues: false,
    settings: {
      components: {
        pageBackground: {
          image: { enabled: false },
          darkMode: { color: '282c34ff' },
        },
        pageHeader: {
          backgroundImage: { enabled: false },
          logo: { location: 'START', enabled: false },
          darkMode: { background: { color: '21252bff' }, borderColor: '3e4451ff' },
        },
        pageFooter: {
          backgroundImage: { enabled: false },
          logo: { location: 'START', enabled: false },
          darkMode: { background: { color: '21252bff' }, borderColor: '3e4451ff' },
        },
        form: {
          borderRadius: 8,
          backgroundImage: { enabled: false },
          logo: { location: 'CENTER', position: 'TOP', enabled: true, formInclusion: 'IN' },
          darkMode: { backgroundColor: '2c313aff', borderColor: '3e4451ff' },
        },
        pageText: {
          darkMode: {
            bodyColor: 'abb2bfff',
            headingColor: 'ffffffff',
            descriptionColor: '5c6370ff',
          },
        },
        primaryButton: {
          darkMode: {
            defaults: { backgroundColor: 'b4532aff', textColor: 'ffffffff' },
            hover: { backgroundColor: '9a4523ff', textColor: 'ffffffff' },
            active: { backgroundColor: '7f381cff', textColor: 'ffffffff' },
            disabled: { backgroundColor: '2c313aff', borderColor: '3e4451ff' },
          },
        },
        secondaryButton: {
          darkMode: {
            defaults: {
              backgroundColor: '2c313aff',
              borderColor: '3e4451ff',
              textColor: 'abb2bfff',
            },
            hover: {
              backgroundColor: '353b45ff',
              borderColor: 'e08a5aff',
              textColor: 'ffffffff',
            },
            active: {
              backgroundColor: '21252bff',
              borderColor: '3e4451ff',
              textColor: 'ffffffff',
            },
          },
        },
        alert: {
          borderRadius: 4,
          darkMode: { error: { backgroundColor: '3a1515ff', borderColor: 'e06c75ff' } },
        },
        idpButton: {
          standard: {
            darkMode: {
              defaults: {
                backgroundColor: '2c313aff',
                borderColor: '3e4451ff',
                textColor: 'abb2bfff',
              },
              hover: {
                backgroundColor: '353b45ff',
                borderColor: 'e08a5aff',
                textColor: 'ffffffff',
              },
              active: {
                backgroundColor: '21252bff',
                borderColor: '3e4451ff',
                textColor: 'ffffffff',
              },
            },
          },
          custom: {},
        },
        phoneNumberSelector: { displayType: 'TEXT' },
        favicon: { enabledTypes: ['ICO', 'SVG'] },
      },
      componentClasses: {
        input: {
          borderRadius: 6,
          darkMode: {
            defaults: { backgroundColor: '21252bff', borderColor: '3e4451ff' },
            placeholderColor: '5c6370ff',
          },
        },
        inputLabel: {
          darkMode: { textColor: 'abb2bfff' },
        },
        inputDescription: {
          darkMode: { textColor: '5c6370ff' },
        },
        link: {
          darkMode: { defaults: { textColor: 'e8a87cff' }, hover: { textColor: 'e08a5aff' } },
        },
        optionControls: {
          darkMode: {
            defaults: { backgroundColor: '21252bff', borderColor: '3e4451ff' },
            selected: { backgroundColor: 'b4532aff', foregroundColor: 'ffffffff' },
          },
        },
        focusState: {
          darkMode: { borderColor: 'e08a5aff' },
        },
      },
      categories: {
        global: {
          colorSchemeMode: 'DARK',
          pageFooter: { enabled: false },
          pageHeader: { enabled: false },
          spacingDensity: 'REGULAR',
        },
      },
    },
    assets: [
      {
        category: 'FORM_LOGO',
        colorMode: 'DARK',
        extension: 'PNG',
        bytes: props.logo.toString('base64'),
      },
    ],
  });
}
