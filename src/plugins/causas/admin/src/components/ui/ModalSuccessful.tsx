import { Button, Dialog } from '@strapi/design-system';
import { Question, CheckCircleEmpty } from '@strapi/icons';
import { useFormikContext } from 'formik';

interface ModalSuccessfulProps {
    isSuccess: boolean;
    activeTab: string;
    setActiveTab: React.Dispatch<React.SetStateAction<string>>;
    setSuccess: React.Dispatch<React.SetStateAction<boolean>>;
    setFileName: React.Dispatch<React.SetStateAction<string>>;
}

export default function ModalSuccessful({
    isSuccess,
    activeTab,
    setActiveTab,
    setSuccess,
    setFileName
}: ModalSuccessfulProps) {
    const mainForm = useFormikContext<FormValuesJuicio>();
    return (
        <Dialog.Root open={isSuccess}>
            <Dialog.Content>
                <Dialog.Header>Registro guardado</Dialog.Header>
                <Dialog.Body icon={<Question fill="success500" />}>
                    {(activeTab === 'instancia') ?
                        '¿Desea llenar datos de casación para este juicio?' :
                        '¿Desea llenar una nueva instancia?'
                    }
                </Dialog.Body>
                <Dialog.Footer>
                    <Dialog.Cancel>
                        <Button fullWidth variant="tertiary" onClick={() => {
                            mainForm.resetForm();
                            setFileName('');
                            setSuccess(false);
                        }}>
                            No
                        </Button>
                    </Dialog.Cancel>
                    <Dialog.Action>
                        <Button
                            fullWidth variant="success-light"
                            size="S"
                            endIcon={<CheckCircleEmpty fill="success600" />}
                            onClick={() => {
                                (activeTab === 'instancia') ?
                                    setActiveTab('casacion') :
                                    setActiveTab('instancia')
                                window.scrollTo({ top: 0, behavior: 'smooth' });
                                setFileName('');
                            }}
                        >
                            Si
                        </Button>
                    </Dialog.Action>
                </Dialog.Footer>
            </Dialog.Content>
        </Dialog.Root>
    )
}